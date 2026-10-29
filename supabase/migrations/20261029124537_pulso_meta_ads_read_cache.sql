-- Read-only Meta Marketing API cache. Apply to isolated staging first.
-- Private spend is authoritative; legacy client-editable metadata is not billing evidence.
create table public.meta_ads_accounts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 ad_account_id uuid not null,
 external_account_id text not null check(external_account_id ~ '^[1-9][0-9]{0,31}$'),
 name text not null check(length(name) between 1 and 250),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 timezone_name text not null,
 account_status integer not null,
 status text not null default 'connected' check(status in ('connected','error','revoked')),
 last_sync_at timestamptz,
 last_error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,external_account_id),
 foreign key(workspace_id,ad_account_id) references public.ad_accounts(workspace_id,id)
);
alter table public.meta_ads_accounts enable row level security;
create policy meta_ads_accounts_member_read on public.meta_ads_accounts for select to authenticated
 using(exists(select 1 from public.workspace_members m where m.workspace_id=meta_ads_accounts.workspace_id and m.user_id=(select auth.uid())));
revoke all on public.meta_ads_accounts from public,anon,authenticated,service_role;
grant select on public.meta_ads_accounts to authenticated;

create table private.meta_ads_credentials (
 connection_id uuid primary key,
 workspace_id uuid not null,
 sealed_credential text not null,
 lease_id uuid,
 lease_until timestamptz,
 updated_at timestamptz not null default now(),
 foreign key(workspace_id,connection_id) references public.meta_ads_accounts(workspace_id,id) on delete cascade
);
create table private.meta_ads_campaigns (
 workspace_id uuid not null,
 connection_id uuid not null,
 external_campaign_id text not null check(external_campaign_id ~ '^[1-9][0-9]{0,31}$'),
 campaign_id uuid not null,
 name text not null,
 status text not null,
 effective_status text not null,
 objective text,
 primary key(workspace_id,connection_id,external_campaign_id),
 foreign key(workspace_id,connection_id) references public.meta_ads_accounts(workspace_id,id) on delete cascade,
 foreign key(workspace_id,campaign_id) references public.campaigns(workspace_id,id)
);
create table private.meta_ads_account_daily (
 workspace_id uuid not null,
 connection_id uuid not null,
 metric_date date not null,
 spend numeric(24,6) not null check(spend>=0),
 fetched_at timestamptz not null default now(),
 primary key(workspace_id,connection_id,metric_date),
 foreign key(workspace_id,connection_id) references public.meta_ads_accounts(workspace_id,id) on delete cascade
);
create table private.meta_ads_campaign_daily (
 workspace_id uuid not null,
 connection_id uuid not null,
 external_campaign_id text not null,
 metric_date date not null,
 spend numeric(24,6) not null check(spend>=0),
 impressions bigint not null check(impressions>=0),
 clicks bigint not null check(clicks>=0),
 primary key(workspace_id,connection_id,external_campaign_id,metric_date),
 foreign key(workspace_id,connection_id,external_campaign_id) references private.meta_ads_campaigns(workspace_id,connection_id,external_campaign_id) on delete cascade
);
alter table private.meta_ads_credentials enable row level security;
alter table private.meta_ads_campaigns enable row level security;
alter table private.meta_ads_account_daily enable row level security;
alter table private.meta_ads_campaign_daily enable row level security;
revoke all on private.meta_ads_credentials,private.meta_ads_campaigns,private.meta_ads_account_daily,private.meta_ads_campaign_daily from public,anon,authenticated,service_role;

create function private.pulso_ads_assert_admin(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and role in ('owner','admin')) then
  raise exception 'Workspace access denied' using errcode='42501';
 end if;
end $$;
revoke all on function private.pulso_ads_assert_admin(uuid,uuid) from public,anon,authenticated,service_role;

create function private.pulso_ads_check_window(p_since date,p_until date)
returns void language plpgsql set search_path='' as $$
begin
 if p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until)
 or p_until<p_since or p_until-p_since>30 or p_until>current_date+1 or p_since<current_date-366 then
  raise exception 'Invalid reporting window' using errcode='22023';
 end if;
end $$;
revoke all on function private.pulso_ads_check_window(date,date) from public,anon,authenticated,service_role;

create function private.pulso_ads_check_account(p_account jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p_account) is distinct from 'object' or coalesce(p_account->>'id','')!~'^[1-9][0-9]{0,31}$'
 or coalesce(p_account->>'currency','')!~'^[A-Z]{3}$'
 or coalesce(length(p_account->>'name'),0) not between 1 and 250
 or coalesce(p_account->>'account_status','')!~'^[0-9]{1,6}$'
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_account->>'timezone_name') then
  raise exception 'Invalid Meta Ads account' using errcode='22023';
 end if;
end $$;
revoke all on function private.pulso_ads_check_account(jsonb) from public,anon,authenticated,service_role;

create function public.pulso_ads_save(p_workspace_id uuid,p_user_id uuid,p_account jsonb,p_sealed_credential text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_box jsonb;v_existing public.meta_ads_accounts;v_integration uuid;v_ad_account uuid;v_id uuid;
begin
 perform private.pulso_ads_assert_admin(p_workspace_id,p_user_id);
 perform private.pulso_ads_check_account(p_account);
 begin
  v_box:=p_sealed_credential::jsonb;
  if p_sealed_credential is null or length(p_sealed_credential)>20000 or jsonb_typeof(v_box) is distinct from 'object'
  or not (v_box ?& array['v','iv','data']) or v_box->'v' is distinct from '1'::jsonb
  or jsonb_typeof(v_box->'iv') is distinct from 'string' or jsonb_typeof(v_box->'data') is distinct from 'string'
  or (select count(*) from jsonb_object_keys(v_box))<>3 or octet_length(decode(v_box->>'iv','base64')) is distinct from 12
  or coalesce(octet_length(decode(v_box->>'data','base64')),0)<16 then raise exception 'invalid';end if;
 exception when others then raise exception 'Invalid sealed credential' using errcode='22023';end;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':ads:'||(p_account->>'id'),0));
 select * into v_existing from public.meta_ads_accounts where workspace_id=p_workspace_id and external_account_id=p_account->>'id' for update;
 if v_existing.id is not null and (v_existing.currency<>p_account->>'currency' or v_existing.timezone_name<>p_account->>'timezone_name') then
  raise exception 'Account facts changed' using errcode='22023';
 end if;
 select id into v_integration from public.integrations where workspace_id=p_workspace_id and provider='meta' and provider_user_id='ads:'||(p_account->>'id') limit 1;
 if v_integration is null then
  insert into public.integrations(workspace_id,provider,provider_user_id,provider_user_name,status,connected_by,connected_at,scopes)
  values(p_workspace_id,'meta','ads:'||(p_account->>'id'),p_account->>'name','connected',p_user_id,now(),array['ads_read']) returning id into v_integration;
 else update public.integrations set status='connected',error_message=null,updated_at=now() where id=v_integration;end if;
 insert into public.ad_accounts(workspace_id,integration_id,provider,external_account_id,name,currency,timezone_name,selected)
 values(p_workspace_id,v_integration,'meta',p_account->>'id',p_account->>'name',p_account->>'currency',p_account->>'timezone_name',true)
 on conflict(provider,external_account_id,workspace_id) do update set integration_id=excluded.integration_id,name=excluded.name,
 currency=excluded.currency,timezone_name=excluded.timezone_name,selected=true returning id into v_ad_account;
 insert into public.meta_ads_accounts(workspace_id,ad_account_id,external_account_id,name,currency,timezone_name,account_status)
 values(p_workspace_id,v_ad_account,p_account->>'id',p_account->>'name',p_account->>'currency',p_account->>'timezone_name',(p_account->>'account_status')::integer)
 on conflict(workspace_id,external_account_id) do update set name=excluded.name,account_status=excluded.account_status,status='connected',last_error_code=null,updated_at=now()
 returning id into v_id;
 insert into private.meta_ads_credentials(connection_id,workspace_id,sealed_credential)
 values(v_id,p_workspace_id,p_sealed_credential)
 on conflict(connection_id) do update set sealed_credential=excluded.sealed_credential,lease_id=null,lease_until=null,updated_at=now();
 return v_id;
end $$;
revoke all on function public.pulso_ads_save(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_save(uuid,uuid,jsonb,text) to service_role;

create function public.pulso_ads_begin_sync(p_workspace_id uuid,p_user_id uuid,p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account public.meta_ads_accounts;v_credential private.meta_ads_credentials;v_lease uuid:=gen_random_uuid();
begin
 perform private.pulso_ads_assert_admin(p_workspace_id,p_user_id);
 select * into v_account from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id for update;
 if v_account.id is null or v_account.status='revoked' then raise exception 'Connection unavailable' using errcode='42501';end if;
 select * into v_credential from private.meta_ads_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id for update;
 if v_credential.connection_id is null then raise exception 'Connection unavailable' using errcode='42501';end if;
 if v_credential.lease_until>now() then raise exception 'Synchronization busy' using errcode='40001';end if;
 update private.meta_ads_credentials set lease_id=v_lease,lease_until=now()+interval '120 seconds' where connection_id=p_connection_id;
 return jsonb_build_object('connection_id',v_account.id,'external_account_id',v_account.external_account_id,'sealed_credential',v_credential.sealed_credential,'lease_id',v_lease);
end $$;
revoke all on function public.pulso_ads_begin_sync(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_begin_sync(uuid,uuid,uuid) to service_role;

create function public.pulso_ads_complete_sync(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,p_since date,p_until date,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account public.meta_ads_accounts;v_credential private.meta_ads_credentials;r jsonb;v_campaign uuid;v_day date;
begin
 perform private.pulso_ads_check_window(p_since,p_until);
 select * into v_account from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id for update;
 select * into v_credential from private.meta_ads_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id for update;
 if v_account.id is null or v_account.status='revoked' or v_credential.connection_id is null
 or v_credential.lease_id is distinct from p_lease_id or p_lease_id is null or v_credential.lease_until<=now() then
  raise exception 'Stale synchronization lease' using errcode='40001';end if;
 if p_until>(now() at time zone v_account.timezone_name)::date then raise exception 'Invalid account reporting window' using errcode='22023';end if;
 perform private.pulso_ads_check_account(p_snapshot->'account');
 if p_snapshot#>>'{account,id}'<>v_account.external_account_id or p_snapshot#>>'{account,currency}'<>v_account.currency
 or p_snapshot#>>'{account,timezone_name}'<>v_account.timezone_name then raise exception 'Account facts changed' using errcode='22023';end if;
 if jsonb_typeof(p_snapshot->'campaigns') is distinct from 'array' or jsonb_typeof(p_snapshot->'daily') is distinct from 'array'
 or jsonb_typeof(p_snapshot->'account_daily') is distinct from 'array' or octet_length(p_snapshot::text)>8000000
 or jsonb_array_length(p_snapshot->'campaigns')>10000 or jsonb_array_length(p_snapshot->'daily')>20000 then
  raise exception 'Invalid Meta Ads snapshot' using errcode='22023';end if;
 -- Validation precedes cache replacement. Any failure rolls back the entire import.
 if exists(select 1 from jsonb_array_elements(p_snapshot->'campaigns') x where jsonb_typeof(x) is distinct from 'object'
 or coalesce(x->>'id','')!~'^[1-9][0-9]{0,31}$' or coalesce(length(x->>'name'),0) not between 1 and 250
 or coalesce(x->>'status','')!~'^[A-Z_]{1,40}$' or coalesce(x->>'effective_status','')!~'^[A-Z_]{1,40}$')
 or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_snapshot->'campaigns') x) then
  raise exception 'Invalid Meta Ads campaigns' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_snapshot->'account_daily') loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'date','')!~'^\d{4}-\d{2}-\d{2}$'
  or coalesce(r->>'spend','')!~'^[0-9]{1,14}(\.[0-9]{1,6})?$' then raise exception 'Invalid spend' using errcode='22023';end if;
  v_day:=(r->>'date')::date;
  if v_day not between p_since and p_until then raise exception 'Invalid spend date' using errcode='22023';end if;
 end loop;
 if (select count(*)<>count(distinct x->>'date') from jsonb_array_elements(p_snapshot->'account_daily') x) then raise exception 'Duplicate spend day' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_snapshot->'daily') loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'date','')!~'^\d{4}-\d{2}-\d{2}$'
  or coalesce(r->>'spend','')!~'^[0-9]{1,14}(\.[0-9]{1,6})?$'
  or coalesce(r->>'impressions','')!~'^[0-9]{1,15}$' or coalesce(r->>'clicks','')!~'^[0-9]{1,15}$'
  or not exists(select 1 from jsonb_array_elements(p_snapshot->'campaigns') c where c->>'id'=r->>'campaign_id') then
   raise exception 'Invalid campaign spend' using errcode='22023';end if;
  v_day:=(r->>'date')::date;
  if v_day not between p_since and p_until then raise exception 'Invalid spend date' using errcode='22023';end if;
 end loop;
 if (select count(*)<>count(distinct (x->>'campaign_id',x->>'date')) from jsonb_array_elements(p_snapshot->'daily') x) then raise exception 'Duplicate campaign day' using errcode='22023';end if;
 -- Account totals are authoritative. Refuse materially inconsistent snapshots.
 if exists(with c as(select (x->>'date')::date as day,sum((x->>'spend')::numeric) as spend from jsonb_array_elements(p_snapshot->'daily') x group by 1),
 a as(select (x->>'date')::date as day,(x->>'spend')::numeric as spend from jsonb_array_elements(p_snapshot->'account_daily') x)
 select 1 from c full join a using(day) where abs(coalesce(c.spend,0)-coalesce(a.spend,0))>0.01) then
  raise exception 'Inconsistent spend totals' using errcode='22023';end if;
 update private.meta_ads_campaigns set status='UNKNOWN',effective_status='UNKNOWN' where workspace_id=p_workspace_id and connection_id=p_connection_id;
 for r in select value from jsonb_array_elements(p_snapshot->'campaigns') loop
  if exists(select 1 from public.campaigns where workspace_id=p_workspace_id and provider='meta' and external_campaign_id=r->>'id' and ad_account_id<>v_account.ad_account_id) then
   raise exception 'Campaign account mismatch' using errcode='22023';end if;
  insert into public.campaigns(workspace_id,ad_account_id,provider,external_campaign_id,name,status,objective)
  values(p_workspace_id,v_account.ad_account_id,'meta',r->>'id',r->>'name',r->>'effective_status',r->>'objective')
  on conflict(provider,external_campaign_id,workspace_id) do update set name=excluded.name,status=excluded.status,objective=excluded.objective,updated_at=now() returning id into v_campaign;
  insert into private.meta_ads_campaigns(workspace_id,connection_id,external_campaign_id,campaign_id,name,status,effective_status,objective)
  values(p_workspace_id,p_connection_id,r->>'id',v_campaign,r->>'name',r->>'status',r->>'effective_status',r->>'objective')
  on conflict(workspace_id,connection_id,external_campaign_id) do update set name=excluded.name,status=excluded.status,effective_status=excluded.effective_status,objective=excluded.objective;
 end loop;
 delete from private.meta_ads_campaign_daily where workspace_id=p_workspace_id and connection_id=p_connection_id and metric_date between p_since and p_until;
 delete from private.meta_ads_account_daily where workspace_id=p_workspace_id and connection_id=p_connection_id and metric_date between p_since and p_until;
 insert into private.meta_ads_account_daily(workspace_id,connection_id,metric_date,spend)
 select p_workspace_id,p_connection_id,d::date,coalesce((select (x->>'spend')::numeric from jsonb_array_elements(p_snapshot->'account_daily') x where (x->>'date')::date=d::date),0)
 from pg_catalog.generate_series(p_since::timestamp,p_until::timestamp,interval '1 day') d;
 insert into private.meta_ads_campaign_daily(workspace_id,connection_id,external_campaign_id,metric_date,spend,impressions,clicks)
 select p_workspace_id,p_connection_id,x->>'campaign_id',(x->>'date')::date,(x->>'spend')::numeric,(x->>'impressions')::bigint,(x->>'clicks')::bigint from jsonb_array_elements(p_snapshot->'daily') x;
 update public.meta_ads_accounts set name=p_snapshot#>>'{account,name}',account_status=(p_snapshot#>>'{account,account_status}')::integer,status='connected',last_error_code=null,last_sync_at=now(),updated_at=now() where id=p_connection_id;
 update public.integrations set last_sync_at=now(),status='connected',error_message=null,updated_at=now()
 where workspace_id=p_workspace_id and provider='meta' and provider_user_id='ads:'||v_account.external_account_id;
 update private.meta_ads_credentials set lease_id=null,lease_until=null where connection_id=p_connection_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.pulso_ads_complete_sync(uuid,uuid,uuid,date,date,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_complete_sync(uuid,uuid,uuid,date,date,jsonb) to service_role;

create function public.pulso_ads_fail_sync(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,p_error_code text)
returns void language plpgsql security definer set search_path='' as $$
declare v_code text;
begin
 if p_lease_id is null then raise exception 'Stale synchronization lease' using errcode='40001';end if;
 perform 1 from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id for update;
 perform 1 from private.meta_ads_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id and lease_id=p_lease_id and lease_until>now() for update;
 if not found then raise exception 'Stale synchronization lease' using errcode='40001';end if;
 v_code:=case when p_error_code in ('meta_ads_auth','meta_ads_permission','meta_ads_transient','meta_ads_network','meta_ads_invalid_response','meta_ads_pagination_limit','meta_ads_rejected') then p_error_code else 'meta_ads_sync_failed' end;
 update public.meta_ads_accounts set status='error',last_error_code=v_code,updated_at=now() where workspace_id=p_workspace_id and id=p_connection_id;
 update public.integrations set status='error',error_message=v_code,updated_at=now()
 where workspace_id=p_workspace_id and provider='meta' and provider_user_id='ads:'||
  (select external_account_id from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id);
 update private.meta_ads_credentials set lease_id=null,lease_until=null where workspace_id=p_workspace_id and connection_id=p_connection_id;
end $$;
revoke all on function public.pulso_ads_fail_sync(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_fail_sync(uuid,uuid,uuid,text) to service_role;

create function public.pulso_ads_revoke(p_workspace_id uuid,p_user_id uuid,p_connection_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.pulso_ads_assert_admin(p_workspace_id,p_user_id);
 perform 1 from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id for update;
 if not found then raise exception 'Connection unavailable' using errcode='42501';end if;
 delete from private.meta_ads_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
 update public.meta_ads_accounts set status='revoked',last_error_code=null,updated_at=now() where workspace_id=p_workspace_id and id=p_connection_id;
 update public.integrations set status='revoked',error_message=null,updated_at=now()
 where workspace_id=p_workspace_id and provider='meta' and provider_user_id='ads:'||
  (select external_account_id from public.meta_ads_accounts where workspace_id=p_workspace_id and id=p_connection_id);
end $$;
revoke all on function public.pulso_ads_revoke(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_revoke(uuid,uuid,uuid) to service_role;

create function private.pulso_ads_metrics_counts(p_workspace_id uuid,p_from date,p_until date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_timezone text;v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()) then raise exception 'Workspace access denied' using errcode='42501';end if;
 perform private.pulso_ads_check_window(p_from,p_until);
 select timezone into v_timezone from public.workspaces where id=p_workspace_id;
 if p_until>(now() at time zone v_timezone)::date then raise exception 'Invalid workspace reporting window' using errcode='22023';end if;
 with accounts as materialized (
  select a.*, coalesce((a.status='connected' and count(d.metric_date)=p_until-p_from+1
   and (p_until<(now() at time zone a.timezone_name)::date or min(d.fetched_at) filter(where d.metric_date=(now() at time zone a.timezone_name)::date)>now()-interval '1 hour')),false) as complete,
   coalesce(sum(d.spend),0) as observed_spend
  from public.meta_ads_accounts a left join private.meta_ads_account_daily d on d.workspace_id=a.workspace_id and d.connection_id=a.id and d.metric_date between p_from and p_until
  where a.workspace_id=p_workspace_id group by a.id
 ), account_rows as(
  select id,external_account_id,name,currency,timezone_name,status,last_sync_at,last_error_code,complete,case when complete then observed_spend end as spend from accounts
 ), campaign_rows as(
  select c.campaign_id as id,c.name,c.status,c.effective_status,a.currency,
   case when a.complete then coalesce(sum(d.spend),0) end as spend,a.name as account_name,a.id as account_id
  from private.meta_ads_campaigns c join accounts a on a.id=c.connection_id and a.workspace_id=c.workspace_id
  left join private.meta_ads_campaign_daily d on d.workspace_id=c.workspace_id and d.connection_id=c.connection_id and d.external_campaign_id=c.external_campaign_id and d.metric_date between p_from and p_until
  where c.workspace_id=p_workspace_id group by c.campaign_id,c.name,c.status,c.effective_status,a.currency,a.complete,a.name,a.id
 ), sales as materialized(
  -- Revenue is provider-independent: every recorded sales platform contributes.
  -- Spend coverage below is explicitly limited to the Meta Ads adapter.
  select s.* from public.sales s where s.workspace_id=p_workspace_id and (s.purchased_at at time zone v_timezone)::date between p_from and p_until
 ), currencies as(select currency from accounts union select currency from sales), financial as(
  select c.currency,
   coalesce((select sum(s.gross_amount) from sales s where s.currency=c.currency and s.status in ('APPROVED','COMPLETE')),0) as approved_revenue,
   case when not exists(select 1 from sales s where s.currency=c.currency and s.status in ('APPROVED','COMPLETE') and (not s.net_amount_verified or s.settlement_currency is distinct from s.currency))
    then coalesce((select sum(s.net_amount) from sales s where s.currency=c.currency and s.status in ('APPROVED','COMPLETE')),0) end as verified_net_revenue,
   (select count(*) from sales s where s.currency=c.currency and s.status in ('REFUNDED','CHARGEBACK')) as refunded_orders,
   (exists(select 1 from accounts a where a.currency=c.currency) and not exists(select 1 from accounts a where a.currency=c.currency and (not a.complete or a.timezone_name<>v_timezone))) as complete,
   case when not exists(select 1 from accounts a where a.currency=c.currency) then 'no_accounts'
    when exists(select 1 from accounts a where a.currency=c.currency and a.timezone_name<>v_timezone) then 'timezone_mismatch'
    when exists(select 1 from accounts a where a.currency=c.currency and not a.complete) then 'missing_coverage' else null end as coverage_reason,
   (select sum(a.observed_spend) from accounts a where a.currency=c.currency) as observed_spend
  from currencies c
 ), financial_rows as(
  select currency,approved_revenue,verified_net_revenue,refunded_orders,complete,coverage_reason,
   case when complete then observed_spend end as media_spend,
   case when complete then approved_revenue-observed_spend end as revenue_after_media,
   case when complete and observed_spend>0 then (approved_revenue-observed_spend)/observed_spend*100 end as media_roi_percent,
   null::numeric as profit,null::numeric as roi_percent from financial
 )
 select jsonb_build_object('version',1,'from',p_from,'until',p_until,
  'media_providers',jsonb_build_array('meta'),'revenue_scope','all_recorded_sales',
  'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by name,id) from account_rows a),'[]'::jsonb),
  'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by name,id) from campaign_rows c),'[]'::jsonb),
  'financial',coalesce((select jsonb_agg(to_jsonb(f) order by currency) from financial_rows f),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
revoke all on function private.pulso_ads_metrics_counts(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function private.pulso_ads_metrics_counts(uuid,date,date) to authenticated;
create function public.pulso_ads_metrics(p_workspace_id uuid,p_from date,p_until date)
returns jsonb language sql stable security invoker set search_path='' begin atomic;
 select private.pulso_ads_metrics_counts(p_workspace_id,p_from,p_until);
end;
revoke all on function public.pulso_ads_metrics(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.pulso_ads_metrics(uuid,date,date) to authenticated;

-- Ads and CAPI share the provider but never the integration identity. Retain the
-- existing CAPI identity (NULL provider_user_id) independently from ads:ACCOUNT.
-- Replace the current function here; previously applied migrations stay intact.
create or replace function public.pulso_meta_save(p_workspace_id uuid,p_user_id uuid,p_dataset_id text,p_ciphertext text,p_mode text default 'test') returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_integration uuid; v_destination uuid;
begin
 perform public.pulso_meta_authorize(p_workspace_id,p_user_id);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':meta_configuration',0));
 if p_dataset_id is null or p_dataset_id !~ '^[0-9]{5,32}$' or p_ciphertext is null or length(p_ciphertext)>20000 or p_mode is distinct from 'test' then raise exception 'Invalid Meta configuration'; end if;
 select id into v_integration from public.integrations where workspace_id=p_workspace_id and provider='meta' and provider_user_id is null for update;
 if v_integration is null then
  insert into public.integrations(workspace_id,provider,status,connected_by,connected_at) values(p_workspace_id,'meta','connected',p_user_id,now()) returning id into v_integration;
 else update public.integrations set status='connected',connected_by=p_user_id,connected_at=now(),error_message=null,updated_at=now() where id=v_integration; end if;
 insert into public.conversion_destinations(workspace_id,integration_id,provider,destination_id,label,is_active,mode,connection_status,last_verified_at)
 values(p_workspace_id,v_integration,'meta',p_dataset_id,'Meta CAPI',true,'test','connected',now())
 on conflict(workspace_id,provider,destination_id) do update set integration_id=excluded.integration_id,is_active=true,mode='test',connection_status='connected',last_verified_at=now(),last_error_code=null,updated_at=now() returning id into v_destination;
 insert into private.meta_capi_credentials(workspace_id,destination_ref,ciphertext,mode) values(p_workspace_id,v_destination,p_ciphertext,'test')
 on conflict(destination_ref) do update set ciphertext=excluded.ciphertext,mode='test',last_verified_at=now(),revoked_at=null,updated_at=now();
 update private.conversion_event_outbox set status='pending',lease_token=null,lease_expires_at=null,next_attempt_at=now(),updated_at=now()
 where workspace_id=p_workspace_id and destination_ref=v_destination and status='sending';
 return v_destination;
end $$;
revoke all on function public.pulso_meta_save(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.pulso_meta_save(uuid,uuid,text,text,text) to service_role;
