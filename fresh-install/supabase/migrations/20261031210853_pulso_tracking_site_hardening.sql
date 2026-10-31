-- Hardening for the new, isolated Pulso database.
-- Keep the privileged function outside the exposed API schema.
alter function public.configure_tracking_site(uuid,text,text[],text) set schema private;

create or replace function private.configure_tracking_site(
  p_workspace_id uuid, p_site_key text, p_allowed_origins text[], p_consent_policy_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare origin text; saved_key text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members
    where workspace_id=p_workspace_id and user_id=auth.uid() and role in ('owner','admin')
  ) then
    raise exception 'Workspace access denied' using errcode='42501';
  end if;
  if p_site_key is null or p_site_key !~ '^[A-Za-z0-9_-]{8,128}$'
    or p_allowed_origins is null or cardinality(p_allowed_origins) not between 1 and 20
    or coalesce(length(p_consent_policy_version),0) not between 1 and 100 then
    raise exception 'Invalid site configuration' using errcode='22023';
  end if;
  foreach origin in array p_allowed_origins loop
    if origin is null or origin !~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$' then
      raise exception 'Invalid HTTPS origin' using errcode='22023';
    end if;
  end loop;
  insert into private.tracking_sites(site_key,workspace_id,allowed_origins,consent_policy_version)
  values(p_site_key,p_workspace_id,p_allowed_origins,p_consent_policy_version)
  on conflict(site_key) do update
    set allowed_origins=excluded.allowed_origins,
        consent_policy_version=excluded.consent_policy_version,
        active=true
    where private.tracking_sites.workspace_id=excluded.workspace_id
  returning site_key into saved_key;
  if saved_key is null then
    raise exception 'Site key unavailable' using errcode='23505';
  end if;
  return jsonb_build_object('site_key',saved_key,'active',true);
end $$;

revoke all on function private.configure_tracking_site(uuid,text,text[],text)
  from public,anon,authenticated,service_role;
grant execute on function private.configure_tracking_site(uuid,text,text[],text) to authenticated;

create function public.configure_tracking_site(
  p_workspace_id uuid, p_site_key text, p_allowed_origins text[], p_consent_policy_version text
) returns jsonb language sql security invoker set search_path=''
begin atomic
  select private.configure_tracking_site(p_workspace_id,p_site_key,p_allowed_origins,p_consent_policy_version);
end;
revoke all on function public.configure_tracking_site(uuid,text,text[],text)
  from public,anon,authenticated,service_role;
grant execute on function public.configure_tracking_site(uuid,text,text[],text) to authenticated;
