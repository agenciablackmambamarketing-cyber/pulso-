-- Additive P0 collector on the audited 12-migration production baseline.
-- Review/apply ONLY in isolated staging first. Not automatically deployed.
create table private.tracking_sites (
 site_key text primary key check(site_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 workspace_id uuid not null references public.workspaces(id),
 allowed_origins text[] not null check(cardinality(allowed_origins) between 1 and 20),
 consent_policy_version text not null check(length(consent_policy_version) between 1 and 100),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(workspace_id,site_key)
);
create table private.tracking_handoffs (
 token_sha256 text primary key check(token_sha256 ~ '^[0-9a-f]{64}$'),
 workspace_id uuid not null,
 site_key text not null,
 tracking_session_id uuid not null,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,site_key) references private.tracking_sites(workspace_id,site_key),
 foreign key(workspace_id,tracking_session_id) references public.tracking_sessions(workspace_id,id)
);
create index tracking_handoffs_session on private.tracking_handoffs(workspace_id,tracking_session_id);
create index tracking_handoffs_expiry on private.tracking_handoffs(expires_at);
create table private.collector_rate_limits (
 bucket text not null,
 window_at timestamptz not null,
 requests integer not null check(requests>0),
 primary key(bucket,window_at)
);
alter table private.visitor_match_context add column click_ids jsonb not null default '{}'::jsonb;
alter table public.funnel_events add column external_event_id uuid;
create unique index funnel_events_idempotency on public.funnel_events(workspace_id,external_event_id) where external_event_id is not null;
-- Close legacy read access to individual identifiers and arbitrary URL values.
revoke select on public.tracking_sessions from authenticated;
revoke select(public_session_id,landing_page,fbclid,gclid,gbraid,wbraid,tblci,src) on public.tracking_sessions from authenticated;
grant select(id,workspace_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term,first_seen_at,last_seen_at) on public.tracking_sessions to authenticated;
revoke select on public.funnel_events from authenticated;
revoke select(id,workspace_id,tracking_session_id,event_name,page_url,occurred_at,metadata,external_event_id) on public.funnel_events from authenticated;
grant select(workspace_id,event_name,occurred_at) on public.funnel_events to authenticated;
-- funnel events hold only '/' + registered origin and no browser IDs in metadata.
-- Restrict identifier-bearing sales origin columns in addition to already restricted raw.
revoke select(src,sck,xcod) on public.sales from authenticated;

alter table private.tracking_sites enable row level security;
alter table private.tracking_handoffs enable row level security;
alter table private.collector_rate_limits enable row level security;
revoke all on private.tracking_sites,private.tracking_handoffs,private.collector_rate_limits from public,anon,authenticated;

create or replace function public.configure_tracking_site(p_workspace_id uuid,p_site_key text,p_allowed_origins text[],p_consent_policy_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare origin text;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'Workspace access denied';end if;
 if cardinality(p_allowed_origins) not between 1 and 20 or coalesce(length(p_consent_policy_version),0) not between 1 and 100 then raise exception 'Invalid site configuration';end if;
 foreach origin in array p_allowed_origins loop
  if origin !~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$' then raise exception 'Invalid HTTPS origin';end if;
 end loop;
 if exists(select 1 from private.tracking_sites where site_key=p_site_key and workspace_id<>p_workspace_id) then raise exception 'Site key unavailable';end if;
 insert into private.tracking_sites(site_key,workspace_id,allowed_origins,consent_policy_version)
 values(p_site_key,p_workspace_id,p_allowed_origins,p_consent_policy_version)
 on conflict(site_key) do update set allowed_origins=excluded.allowed_origins,consent_policy_version=excluded.consent_policy_version,active=true;
 return jsonb_build_object('site_key',p_site_key,'active',true);
end $$;
revoke all on function public.configure_tracking_site(uuid,text,text[],text) from public,anon;
grant execute on function public.configure_tracking_site(uuid,text,text[],text) to authenticated;

create or replace function public.pulso_site_config(p_site_key text)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('active',active,'allowed_origins',allowed_origins,'consent_policy_version',consent_policy_version) from private.tracking_sites where site_key=p_site_key;
$$;
revoke all on function public.pulso_site_config(text) from public,anon,authenticated;
grant execute on function public.pulso_site_config(text) to service_role;

-- Both buckets are atomic across Edge isolates, without raw IP retention.
create or replace function private.collector_rate_limit(p_bucket text,p_limit integer)
returns void language plpgsql set search_path='' as $$
declare n integer;
begin
 insert into private.collector_rate_limits(bucket,window_at,requests) values(p_bucket,date_trunc('minute',now()),1)
 on conflict(bucket,window_at) do update set requests=private.collector_rate_limits.requests+1 returning requests into n;
 if n>p_limit then raise exception 'rate_limit';end if;
end $$;
revoke all on function private.collector_rate_limit(text,integer) from public,anon,authenticated;

create or replace function public.pulso_record_event(p_site_key text,p_origin text,p_input jsonb,p_handoff_hash text,p_handoff_expires_at timestamptz,p_ip_hash text,p_client_ip inet,p_user_agent text,p_resume_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare site private.tracking_sites;session_id uuid;expires timestamptz;inserted_id uuid;click jsonb;source text;medium text;campaign text;consent_at timestamptz;existing_event public.funnel_events;
begin
 select * into site from private.tracking_sites where site_key=p_site_key and active and p_origin=any(allowed_origins);
 if not found then raise exception 'origin_denied';end if;
 if p_input->>'site_key' is distinct from p_site_key or p_input->>'event_name' not in ('page_view','view_content','checkout_click','checkout_started')
 or p_input#>>'{consent,marketing}' is distinct from 'true' or p_input#>>'{consent,basis}' is distinct from 'consent'
 or p_input#>>'{consent,policy_version}' is distinct from site.consent_policy_version then raise exception 'consent_required';end if;
 consent_at:=(p_input#>>'{consent,captured_at}')::timestamptz;
 if consent_at is null or consent_at>now()+interval '1 minute' or consent_at<now()-interval '1 day' then raise exception 'consent_required';end if;
 perform private.collector_rate_limit('site:'||p_site_key,1000);
 if p_ip_hash is not null then
  if p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid rate key';end if;
  perform private.collector_rate_limit('ip:'||p_site_key||':'||p_ip_hash,120);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(site.workspace_id::text||':'||(p_input->>'event_id'),0));
 select * into existing_event from public.funnel_events where workspace_id=site.workspace_id and external_event_id=(p_input->>'event_id')::uuid;
 if existing_event.id is not null and existing_event.event_name<>p_input->>'event_name' then raise exception 'invalid_event';end if;
 if p_resume_hash is not null then
  select h.tracking_session_id,h.expires_at into session_id,expires from private.tracking_handoffs h
   join private.visitor_match_context c on c.workspace_id=h.workspace_id and c.tracking_session_id=h.tracking_session_id
   where h.token_sha256=p_resume_hash and h.workspace_id=site.workspace_id and h.site_key=p_site_key and h.expires_at>now() and h.revoked_at is null and c.marketing_allowed and c.expires_at>now() for update of h;
  if session_id is null then raise exception 'invalid_resume';end if;
 elsif existing_event.id is not null then
  select h.tracking_session_id,min(h.expires_at) into session_id,expires from private.tracking_handoffs h
   join private.visitor_match_context c on c.workspace_id=h.workspace_id and c.tracking_session_id=h.tracking_session_id
   where h.tracking_session_id=existing_event.tracking_session_id and h.workspace_id=site.workspace_id and h.site_key=p_site_key and h.expires_at>now() and h.revoked_at is null and c.marketing_allowed and c.expires_at>now() group by h.tracking_session_id;
  if session_id is null then raise exception 'invalid_resume';end if;
 else
  expires:=least(p_handoff_expires_at,now()+interval '1 day');
  if expires<=now() then raise exception 'invalid_expiry';end if;
  click:=coalesce(p_input->'click','{}'::jsonb);
  source:=case lower(click->>'utm_source') when 'facebook' then 'meta' when 'instagram' then 'meta' when 'meta' then 'meta' when 'google' then 'google' when 'taboola' then 'taboola' else null end;
  medium:=case when click->>'utm_medium' in ('cpc','paid_social','paid_search','organic','referral','email') then click->>'utm_medium' end;
  -- Only configured campaign names can become dashboard-visible labels.
  select name into campaign from public.campaigns where workspace_id=site.workspace_id and external_campaign_id=click->>'utm_campaign' limit 1;
  insert into public.tracking_sessions(workspace_id,public_session_id,landing_page,utm_source,utm_medium,utm_campaign)
   values(site.workspace_id,gen_random_uuid(),p_origin||'/',source,medium,campaign) returning id into session_id;
  insert into private.visitor_match_context(workspace_id,tracking_session_id,marketing_allowed,legal_basis_record,consent_captured_at,consent_policy_version,fbp,fbc,client_ip,client_user_agent,captured_at,expires_at,click_ids)
  values(site.workspace_id,session_id,true,'consent',consent_at,site.consent_policy_version,p_input#>>'{browser,fbp}',p_input#>>'{browser,fbc}',p_client_ip,left(p_user_agent,512),now(),expires,click);
 end if;
 if existing_event.id is not null and existing_event.tracking_session_id<>session_id then raise exception 'invalid_resume';end if;
 -- Retain first-touch attribution and fixed TTL; never refresh consent/TTL implicitly.
 update public.tracking_sessions set last_seen_at=now() where workspace_id=site.workspace_id and id=session_id;
 insert into public.funnel_events(workspace_id,tracking_session_id,event_name,page_url,external_event_id)
 values(site.workspace_id,session_id,p_input->>'event_name',p_origin||'/',(p_input->>'event_id')::uuid)
 on conflict(workspace_id,external_event_id) where external_event_id is not null do nothing returning id into inserted_id;
 insert into private.tracking_handoffs(token_sha256,workspace_id,site_key,tracking_session_id,expires_at)
 values(p_handoff_hash,site.workspace_id,p_site_key,session_id,expires);
 return jsonb_build_object('duplicate',inserted_id is null,'expires_at',expires);
end $$;
revoke all on function public.pulso_record_event(text,text,jsonb,text,timestamptz,text,inet,text,text) from public,anon,authenticated;
grant execute on function public.pulso_record_event(text,text,jsonb,text,timestamptz,text,inet,text,text) to service_role;

create or replace function public.pulso_revoke_session(p_site_key text,p_origin text,p_resume_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare h private.tracking_handoffs;
begin
 select th.* into h from private.tracking_handoffs th join private.tracking_sites ts on ts.workspace_id=th.workspace_id and ts.site_key=th.site_key
 where th.token_sha256=p_resume_hash and th.site_key=p_site_key and p_origin=any(ts.allowed_origins);
 if not found then raise exception 'invalid_resume';end if;
 update private.tracking_handoffs set revoked_at=now() where workspace_id=h.workspace_id and tracking_session_id=h.tracking_session_id;
 update private.visitor_match_context set marketing_allowed=false,fbp=null,fbc=null,client_ip=null,client_user_agent=null,click_ids='{}'::jsonb
 where workspace_id=h.workspace_id and tracking_session_id=h.tracking_session_id;
 update private.conversion_event_outbox o set status=case when o.status='delivered' then 'delivered' else 'failed' end,last_error_code=case when o.status='delivered' then o.last_error_code else 'consent_revoked' end,updated_at=now(),fbp=null,fbc=null,client_ip=null,client_user_agent=null,email_sha256=null,phone_sha256=null,first_name_sha256=null,last_name_sha256=null,city_sha256=null,state_sha256=null,postcode_sha256=null,country_sha256=null,external_id_sha256=null
 where o.workspace_id=h.workspace_id and exists(select 1 from public.attributions a where a.workspace_id=o.workspace_id and a.sale_id=o.sale_id and a.tracking_session_id=h.tracking_session_id);
end $$;
revoke all on function public.pulso_revoke_session(text,text,text) from public,anon,authenticated;
grant execute on function public.pulso_revoke_session(text,text,text) to service_role;

create or replace function public.pulso_retention_cleanup()
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from private.tracking_handoffs where expires_at<now()-interval '1 day';
 delete from private.collector_rate_limits where window_at<now()-interval '1 day';
 perform private.pulso_scrub_expired_capi();
 delete from private.visitor_match_context where expires_at<now();
 -- financial/aggregate records have a separate legal retention policy.
end $$;
revoke all on function public.pulso_retention_cleanup() from public,anon,authenticated;
grant execute on function public.pulso_retention_cleanup() to service_role;
