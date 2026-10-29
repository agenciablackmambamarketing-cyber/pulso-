-- Read-only, session-cohort funnel. Apply to isolated staging first.
-- Keep session identifiers backend-only: no new table/column grants are needed.
create index if not exists funnel_events_ordered_session
  on public.funnel_events(workspace_id,tracking_session_id,event_name,occurred_at);

create or replace function private.pulso_dashboard_funnel_counts(p_workspace_id uuid,p_since timestamptz)
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare v_user uuid:=auth.uid(); v_until timestamptz:=now(); v_result jsonb;
begin
  -- The privileged helper can only return aggregate counts for an actual member.
  -- Never accept an actor ID or rely on user-editable JWT metadata.
  if v_user is null or not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id=p_workspace_id and wm.user_id=v_user
  ) then raise exception 'Workspace access denied' using errcode='42501'; end if;
  if p_since is null or not isfinite(p_since) or p_since>v_until
    or p_since<v_until-interval '366 days' then
    raise exception 'Invalid reporting window' using errcode='22023';
  end if;

  with cohort as materialized (
    select s.id,min(e.occurred_at) as entered_at
    from public.tracking_sessions s
    join public.funnel_events e
      on e.workspace_id=s.workspace_id and e.tracking_session_id=s.id
    where s.workspace_id=p_workspace_id
      and s.first_seen_at between p_since and v_until
      and e.workspace_id=p_workspace_id and e.event_name='page_view'
      and e.occurred_at between greatest(p_since,s.first_seen_at) and v_until
    group by s.id
  ), paths as (
    select c.id,content.content_at,click.click_at,checkout.checkout_at,
      content.click_observed,content.checkout_observed
    from cohort c
    left join lateral (
      select min(e.occurred_at) filter(where e.event_name='view_content') as content_at,
        coalesce(bool_or(e.event_name='checkout_click'),false) as click_observed,
        coalesce(bool_or(e.event_name='checkout_started'),false) as checkout_observed
      from public.funnel_events e
      where e.workspace_id=p_workspace_id and e.tracking_session_id=c.id
        and e.event_name in ('view_content','checkout_click','checkout_started')
        and e.occurred_at between c.entered_at and v_until
    ) content on true
    left join lateral (
      select min(e.occurred_at) as click_at
      from public.funnel_events e
      where e.workspace_id=p_workspace_id and e.tracking_session_id=c.id
        and e.event_name='checkout_click'
        and e.occurred_at between content.content_at and v_until
    ) click on true
    left join lateral (
      select min(e.occurred_at) as checkout_at
      from public.funnel_events e
      where e.workspace_id=p_workspace_id and e.tracking_session_id=c.id
        and e.event_name='checkout_started'
        and e.occurred_at between click.click_at and v_until
    ) checkout on true
  )
  select jsonb_build_object(
    'version',1,'basis','ordered_sessions','since',p_since,'until',v_until,
    'stages',jsonb_build_array(
      jsonb_build_object('key','page_view','sessions',count(*)),
      jsonb_build_object('key','view_content','sessions',count(content_at)),
      jsonb_build_object('key','checkout_click','sessions',count(click_at)),
      jsonb_build_object('key','checkout_started','sessions',count(checkout_at))
    ),
    'observed_checkout_sessions',count(*) filter(where checkout_observed),
    'incomplete_path_sessions',count(*) filter(where
      (click_observed and click_at is null) or (checkout_observed and checkout_at is null))
  ) into v_result from paths;
  return v_result;
end;
$$;
revoke all on function private.pulso_dashboard_funnel_counts(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.pulso_dashboard_funnel_counts(uuid,timestamptz) to authenticated;

-- SQL-standard body binds the private helper at definition time. The wrapper
-- remains INVOKER without granting schema USAGE or any private table access.
-- The private helper repeats membership validation on every call.
create or replace function public.pulso_dashboard_funnel(p_workspace_id uuid,p_since timestamptz)
returns jsonb language sql stable security invoker
set search_path = ''
begin atomic;
  select private.pulso_dashboard_funnel_counts(p_workspace_id,p_since);
end;
revoke all on function public.pulso_dashboard_funnel(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.pulso_dashboard_funnel(uuid,timestamptz) to authenticated;
