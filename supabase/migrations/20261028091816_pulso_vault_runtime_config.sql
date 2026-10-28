-- Supported Supabase Vault integration. No secrets or environment-specific values.
-- New staging only for this release; production requires its own reviewed deployment.
create table private.pulso_runtime_secret_refs (
 setting_name text primary key check(setting_name in (
  'PULSO_HANDOFF_HMAC_KEY','PULSO_RATE_HASH_KEY','PULSO_DASHBOARD_ORIGINS',
  'PULSO_ADMIN_ORIGINS','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION','PULSO_META_WORKER_SECRET'
 )),
 vault_secret_id uuid not null,
 created_at timestamptz not null default now()
);
alter table private.pulso_runtime_secret_refs enable row level security;
revoke all on private.pulso_runtime_secret_refs from public,anon,authenticated,service_role;

create or replace function public.pulso_runtime_config(p_component text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_names text[]; v_result jsonb;
begin
 -- Fixed component mappings: callers cannot request an arbitrary Vault secret.
 v_names:=case p_component
 when 'collector' then array['PULSO_HANDOFF_HMAC_KEY','PULSO_RATE_HASH_KEY']
 when 'webhook' then array['PULSO_HANDOFF_HMAC_KEY']
 when 'hotmart_connect' then array['PULSO_DASHBOARD_ORIGINS']
 when 'meta_connect' then array['PULSO_ADMIN_ORIGINS','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION']
 when 'meta_worker' then array['PULSO_META_WORKER_SECRET','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION']
 else null end;
 if v_names is null or to_regclass('vault.decrypted_secrets') is null then
  raise exception 'Runtime configuration unavailable' using errcode='55000';
 end if;
 -- Dynamic constant SQL lets migration apply on local PostgreSQL without Vault.
 -- The decrypted view is accessed only by this owner's narrowly scoped helper.
 execute 'select jsonb_object_agg(r.setting_name,s.decrypted_secret)
   from private.pulso_runtime_secret_refs r
   join vault.decrypted_secrets s on s.id=r.vault_secret_id
   where r.setting_name=any($1)' into v_result using v_names;
 if v_result is null or (select count(*) from jsonb_object_keys(v_result))<>cardinality(v_names)
   or exists(select 1 from jsonb_each_text(v_result) where value is null or value='') then
  raise exception 'Runtime configuration unavailable' using errcode='55000';
 end if;
 return v_result;
end;$$;
revoke all on function public.pulso_runtime_config(text) from public,anon,authenticated;
grant execute on function public.pulso_runtime_config(text) to service_role;
