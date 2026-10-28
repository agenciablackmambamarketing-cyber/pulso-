-- Additive P0 CAPI queue/credentials. Apply only after audited baseline, never replay legacy SQL.
-- Ciphertext is AES-256-GCM sealed in Edge with AAD workspace:dataset; master key is not in SQL.
alter table public.conversion_destinations add column if not exists mode text not null default 'test' check (mode in ('test','production'));
alter table public.conversion_destinations add column if not exists connection_status text not null default 'pending';
alter table public.conversion_destinations add column if not exists last_verified_at timestamptz;
alter table public.conversion_destinations add column if not exists last_error_code text;
revoke insert,update,delete on public.conversion_destinations from anon,authenticated;

create table if not exists private.meta_capi_credentials (
 workspace_id uuid not null,
 destination_ref uuid primary key,
 ciphertext text not null,
 key_version integer not null default 1,
 mode text not null default 'test' check(mode in ('test','production')),
 last_verified_at timestamptz not null default now(),
 revoked_at timestamptz,
 updated_at timestamptz not null default now(),
 foreign key(workspace_id,destination_ref) references public.conversion_destinations(workspace_id,id) on delete cascade
);
alter table private.meta_capi_credentials enable row level security;
revoke all on private.meta_capi_credentials from public,anon,authenticated;

alter table private.conversion_event_outbox add column if not exists tracking_session_id uuid;
alter table private.conversion_event_outbox add column if not exists test_mode boolean not null default true;
alter table private.conversion_event_outbox add column if not exists lease_token uuid;
alter table private.conversion_event_outbox add column if not exists lease_expires_at timestamptz;
alter table private.conversion_event_outbox add column if not exists http_status integer;
alter table private.conversion_event_outbox add column if not exists meta_error_code integer;
alter table private.conversion_event_outbox add column if not exists accepted_at timestamptz;
alter table private.conversion_event_outbox add constraint meta_outbox_same_session foreign key(workspace_id,tracking_session_id) references public.tracking_sessions(workspace_id,id);
create index if not exists meta_outbox_due on private.conversion_event_outbox(next_attempt_at) where provider='meta' and status in ('pending','sending');

create table if not exists public.capi_delivery_diagnostics (
 id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade,
 destination_ref uuid not null, status text not null, attempt_count integer not null,
 last_error_code text, next_attempt_at timestamptz, updated_at timestamptz not null,
 test_mode boolean not null, http_status integer, meta_error_code integer, accepted_at timestamptz,
 foreign key(workspace_id,destination_ref) references public.conversion_destinations(workspace_id,id) on delete cascade
);
alter table public.capi_delivery_diagnostics enable row level security;
revoke all on public.capi_delivery_diagnostics from public,anon,authenticated;
grant select on public.capi_delivery_diagnostics to authenticated;
create policy capi_workspace_read on public.capi_delivery_diagnostics for select to authenticated using
 (exists(select 1 from public.workspace_members wm where wm.workspace_id=capi_delivery_diagnostics.workspace_id and wm.user_id=(select auth.uid())));
create or replace function private.pulso_sync_capi_diagnostics() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if TG_OP='DELETE' then delete from public.capi_delivery_diagnostics where id=OLD.id; return OLD; end if;
 insert into public.capi_delivery_diagnostics(id,workspace_id,destination_ref,status,attempt_count,last_error_code,next_attempt_at,updated_at,test_mode,http_status,meta_error_code,accepted_at)
 values(NEW.id,NEW.workspace_id,NEW.destination_ref,NEW.status,NEW.attempt_count,NEW.last_error_code,NEW.next_attempt_at,NEW.updated_at,NEW.test_mode,NEW.http_status,NEW.meta_error_code,NEW.accepted_at)
 on conflict(id) do update set status=excluded.status,attempt_count=excluded.attempt_count,last_error_code=excluded.last_error_code,
 next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,test_mode=excluded.test_mode,http_status=excluded.http_status,meta_error_code=excluded.meta_error_code,accepted_at=excluded.accepted_at;
 return NEW;
end $$;
revoke all on function private.pulso_sync_capi_diagnostics() from public,anon,authenticated;
create trigger pulso_capi_diagnostics after insert or update or delete on private.conversion_event_outbox for each row execute function private.pulso_sync_capi_diagnostics();
-- Populate only non-sensitive queue state from any pre-existing rows.
insert into public.capi_delivery_diagnostics(id,workspace_id,destination_ref,status,attempt_count,last_error_code,next_attempt_at,updated_at,test_mode,http_status,meta_error_code,accepted_at)
 select id,workspace_id,destination_ref,status,attempt_count,last_error_code,next_attempt_at,updated_at,test_mode,http_status,meta_error_code,accepted_at from private.conversion_event_outbox on conflict(id) do nothing;

create or replace function public.pulso_meta_authorize(p_workspace_id uuid,p_user_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and role in ('owner','admin')) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 return true;
end $$;

create or replace function public.pulso_meta_save(p_workspace_id uuid,p_user_id uuid,p_dataset_id text,p_ciphertext text,p_mode text default 'test') returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_integration uuid; v_destination uuid;
begin
 perform public.pulso_meta_authorize(p_workspace_id,p_user_id);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':meta_configuration',0));
 if p_dataset_id !~ '^[0-9]{5,32}$' or p_ciphertext is null or length(p_ciphertext)>20000 or p_mode<>'test' then raise exception 'Invalid Meta configuration'; end if;
 -- A workspace has exactly one Meta integration, established by the existing unique key.
 select id into v_integration from public.integrations where workspace_id=p_workspace_id and provider='meta' for update;
 if v_integration is null then
  insert into public.integrations(workspace_id,provider,status,connected_by,connected_at) values(p_workspace_id,'meta','connected',p_user_id,now()) returning id into v_integration;
 else update public.integrations set status='connected',connected_by=p_user_id,connected_at=now(),error_message=null,updated_at=now() where id=v_integration; end if;
 insert into public.conversion_destinations(workspace_id,integration_id,provider,destination_id,label,is_active,mode,connection_status,last_verified_at)
 values(p_workspace_id,v_integration,'meta',p_dataset_id,'Meta CAPI',true,'test','connected',now())
 on conflict(workspace_id,provider,destination_id) do update set integration_id=excluded.integration_id,is_active=true,mode='test',connection_status='connected',last_verified_at=now(),last_error_code=null,updated_at=now() returning id into v_destination;
 insert into private.meta_capi_credentials(workspace_id,destination_ref,ciphertext,mode) values(p_workspace_id,v_destination,p_ciphertext,'test')
 on conflict(destination_ref) do update set ciphertext=excluded.ciphertext,mode='test',last_verified_at=now(),revoked_at=null,updated_at=now();
 -- A rotated credential fences all in-flight leases before the new token can be claimed.
 update private.conversion_event_outbox set status='pending',lease_token=null,lease_expires_at=null,next_attempt_at=now(),updated_at=now()
 where workspace_id=p_workspace_id and destination_ref=v_destination and status='sending';
 return v_destination;
end $$;

create or replace function public.pulso_meta_credential(p_workspace_id uuid,p_destination_ref uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public,private,pg_temp as $$
 select jsonb_build_object('destination_ref',d.id,'dataset_id',d.destination_id,'ciphertext',c.ciphertext,'mode',c.mode)
 from public.conversion_destinations d join private.meta_capi_credentials c on c.workspace_id=d.workspace_id and c.destination_ref=d.id
 where d.workspace_id=p_workspace_id and d.id=p_destination_ref and d.provider='meta' and c.revoked_at is null;
$$;

create or replace function public.pulso_meta_control(p_workspace_id uuid,p_user_id uuid,p_destination_ref uuid,p_action text,p_outbox_id uuid default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 perform public.pulso_meta_authorize(p_workspace_id,p_user_id);
 if not exists(select 1 from public.conversion_destinations where workspace_id=p_workspace_id and id=p_destination_ref and provider='meta') then raise exception 'Destination not found'; end if;
 if p_action in ('disable','revoke') then
  update public.conversion_destinations set is_active=false,connection_status=case when p_action='revoke' then 'revoked' else 'disabled' end,updated_at=now() where id=p_destination_ref and workspace_id=p_workspace_id;
  if p_action='revoke' then delete from private.meta_capi_credentials where workspace_id=p_workspace_id and destination_ref=p_destination_ref; end if;
  update private.conversion_event_outbox set status='failed',last_error_code='destination_disabled',lease_token=null,lease_expires_at=null,updated_at=now()
  where workspace_id=p_workspace_id and destination_ref=p_destination_ref and status<>'delivered';
 elsif p_action='reprocess' then
  -- Reprocessing cannot resurrect a reversed purchase, expired event, revoked consent or removed credential.
  update private.conversion_event_outbox o set status='pending',next_attempt_at=now(),attempt_count=0,last_error_code=null,lease_token=null,lease_expires_at=null,updated_at=now()
  where o.workspace_id=p_workspace_id and o.destination_ref=p_destination_ref and o.id=p_outbox_id and o.status='failed' and o.event_time>now()-interval '6 days'
  and exists(select 1 from public.sales s where s.workspace_id=o.workspace_id and s.id=o.sale_id and s.status in ('APPROVED','COMPLETE'))
  and exists(select 1 from private.visitor_match_context v where v.workspace_id=o.workspace_id and v.tracking_session_id=o.tracking_session_id and v.marketing_allowed and v.expires_at>now())
  and exists(select 1 from public.conversion_destinations d join private.meta_capi_credentials c on c.destination_ref=d.id and c.workspace_id=d.workspace_id where d.id=o.destination_ref and d.workspace_id=o.workspace_id and d.is_active and c.revoked_at is null);
  return found;
 else raise exception 'Invalid operation'; end if;
 return true;
end $$;

create or replace function public.pulso_meta_claim(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare v_result jsonb;
begin
 -- A crash on the final attempt must reach a terminal state rather than remain sending forever.
 update private.conversion_event_outbox set status='failed',last_error_code='attempts_exhausted',lease_token=null,lease_expires_at=null,updated_at=now()
 where provider='meta' and attempt_count>=8 and (status='pending' or (status='sending' and lease_expires_at<now()));
 -- Mark permanently ineligible jobs; do not leave them looking ready to send.
 update private.conversion_event_outbox o set status='failed',last_error_code='delivery_not_authorized',lease_token=null,lease_expires_at=null,updated_at=now()
 where o.provider='meta' and o.status in ('pending','sending') and (o.status='pending' or o.lease_expires_at<now()) and (
  o.event_time<now()-interval '6 days'
  or not exists(select 1 from public.sales s where s.workspace_id=o.workspace_id and s.id=o.sale_id and s.status in ('APPROVED','COMPLETE'))
  or not exists(select 1 from private.visitor_match_context v where v.workspace_id=o.workspace_id and v.tracking_session_id=o.tracking_session_id and v.marketing_allowed and v.expires_at>now())
 );
 with due as (
  select o.id from private.conversion_event_outbox o
  join public.conversion_destinations d on d.workspace_id=o.workspace_id and d.id=o.destination_ref and d.provider=o.provider
  join private.meta_capi_credentials c on c.workspace_id=o.workspace_id and c.destination_ref=d.id
  where o.provider='meta' and d.is_active and c.revoked_at is null and o.attempt_count<8 and o.next_attempt_at<=now()
    and (o.status='pending' or (o.status='sending' and o.lease_expires_at<now()))
  order by o.next_attempt_at for update of o skip locked limit greatest(1,least(p_limit,25))
 ), claimed as (
  update private.conversion_event_outbox o set status='sending',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '60 seconds',updated_at=now()
  from due where o.id=due.id returning o.*
 ) select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('dataset_id',d.destination_id,'ciphertext',c.ciphertext,'credential_mode',c.mode)),'[]'::jsonb) into v_result
 from claimed o join public.conversion_destinations d on d.workspace_id=o.workspace_id and d.id=o.destination_ref
 join private.meta_capi_credentials c on c.workspace_id=o.workspace_id and c.destination_ref=o.destination_ref;
 return v_result;
end $$;

create or replace function public.pulso_meta_lease_valid(p_id uuid,p_lease_token uuid) returns boolean
language sql security definer set search_path=pg_catalog,public,private,pg_temp as $$
 select exists(select 1 from private.conversion_event_outbox o
 join public.sales s on s.workspace_id=o.workspace_id and s.id=o.sale_id
 join public.conversion_destinations d on d.workspace_id=o.workspace_id and d.id=o.destination_ref
 join private.meta_capi_credentials c on c.workspace_id=o.workspace_id and c.destination_ref=o.destination_ref
 where o.id=p_id and o.lease_token=p_lease_token and o.status='sending' and o.lease_expires_at>now() and d.is_active and c.revoked_at is null and s.status in ('APPROVED','COMPLETE')
 and exists(select 1 from private.visitor_match_context v where v.workspace_id=o.workspace_id and v.tracking_session_id=o.tracking_session_id and v.marketing_allowed and v.expires_at>now()));
$$;

create or replace function public.pulso_meta_finish(p_id uuid,p_lease_token uuid,p_accepted boolean,p_retryable boolean,p_http_status integer,p_meta_error_code integer,p_error_code text,p_response_id text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 if p_error_code is not null and p_error_code !~ '^[a-z_]{1,50}$' then raise exception 'Invalid error code'; end if;
 update private.conversion_event_outbox set
 status=case when p_accepted then 'delivered' when p_retryable and attempt_count<8 then 'pending' else 'failed' end,
 next_attempt_at=now()+make_interval(secs=>least(3600,30*(2^least(attempt_count,7))::integer)),
 http_status=p_http_status,meta_error_code=p_meta_error_code,last_error_code=case when p_accepted then null else coalesce(p_error_code,'meta_rejected') end,
 provider_response_id=case when p_response_id ~ '^[A-Za-z0-9_-]{1,128}$' then p_response_id end,
 accepted_at=case when p_accepted then now() else null end,
 lease_token=null,lease_expires_at=null,updated_at=now()
 where id=p_id and lease_token=p_lease_token and status='sending' and lease_expires_at>now();
 return found;
end $$;

-- Called by the global retention job BEFORE deleting expired visitor contexts.
-- Hashes remain personal data; delivery is not permission for indefinite retention.
create or replace function private.pulso_scrub_expired_capi() returns void
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
begin
 update private.conversion_event_outbox o set
 fbp=null,fbc=null,client_ip=null,client_user_agent=null,email_sha256=null,phone_sha256=null,
 first_name_sha256=null,last_name_sha256=null,city_sha256=null,state_sha256=null,postcode_sha256=null,country_sha256=null,external_id_sha256=null,
 status=case when o.status='delivered' then o.status else 'failed' end,
 last_error_code=case when o.status='delivered' then o.last_error_code else 'matching_expired' end,
 lease_token=null,lease_expires_at=null,updated_at=now()
 where not exists(select 1 from private.visitor_match_context v
  where v.workspace_id=o.workspace_id and v.tracking_session_id=o.tracking_session_id and v.marketing_allowed and v.expires_at>now())
 and (o.fbp is not null or o.fbc is not null or o.client_ip is not null or o.client_user_agent is not null or o.email_sha256 is not null or o.phone_sha256 is not null
  or o.first_name_sha256 is not null or o.last_name_sha256 is not null or o.city_sha256 is not null or o.state_sha256 is not null
  or o.postcode_sha256 is not null or o.country_sha256 is not null or o.external_id_sha256 is not null);
end $$;
revoke all on function private.pulso_scrub_expired_capi() from public,anon,authenticated;

-- Only privileged Edge callers can invoke these helpers; never use user-supplied actor IDs without getUser.
DO $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pulso_meta_%' loop
  execute format('revoke all on function %s from public, anon, authenticated',r.signature);
  execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
