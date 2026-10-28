-- Read-only aggregates. Invoker privileges + existing RLS remain in force.
-- No buyer, raw URL, click ID, handoff, token or matching hash is returned.
create or replace function public.pulso_dashboard_metrics(p_workspace_id uuid, p_since timestamptz)
returns jsonb language plpgsql stable security invoker
set search_path = ''
as $$
declare v_result jsonb; v_timezone text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  ) then raise exception 'Workspace access denied' using errcode = '42501'; end if;
  if p_since is null or p_since > now() or p_since < now() - interval '366 days' then
    raise exception 'Invalid reporting window' using errcode = '22023';
  end if;
  select timezone into v_timezone from public.workspaces where id = p_workspace_id;
  v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
  with sales as materialized (
    select s.id,s.workspace_id,s.status,s.currency,s.gross_amount,s.purchased_at,
      a.tracking_session_id,
      (a.method in ('session_id','click_id') and a.tracking_session_id is not null) as attributed
    from public.sales s left join public.attributions a on a.sale_id=s.id and a.workspace_id=s.workspace_id
    where s.workspace_id=p_workspace_id and s.purchased_at >= p_since
  ), summary as (
    select currency,
      count(*) filter(where status in ('APPROVED','COMPLETE')) as approved_orders,
      coalesce(sum(gross_amount) filter(where status in ('APPROVED','COMPLETE')),0) as approved_revenue,
      count(*) filter(where status in ('REFUNDED','CHARGEBACK')) as reversed_orders,
      count(*) filter(where status in ('APPROVED','COMPLETE') and coalesce(attributed,false)) as attributed_orders,
      count(*) filter(where status in ('APPROVED','COMPLETE') and not coalesce(attributed,false)) as unattributed_orders
    from sales group by currency
  ), source_rows as (
    select s.currency,
      case when s.attributed then t.utm_source end as utm_source,
      case when s.attributed then t.utm_medium end as utm_medium,
      case when s.attributed then t.utm_campaign end as utm_campaign,
      case when s.attributed then t.utm_content end as utm_content,
      case when s.attributed then t.utm_term end as utm_term,
      count(*) as orders, sum(s.gross_amount) as revenue
    from sales s left join public.tracking_sessions t on t.id=s.tracking_session_id and t.workspace_id=s.workspace_id
    where s.status in ('APPROVED','COMPLETE')
    group by s.currency,
      case when s.attributed then t.utm_source end,
      case when s.attributed then t.utm_medium end,
      case when s.attributed then t.utm_campaign end,
      case when s.attributed then t.utm_content end,
      case when s.attributed then t.utm_term end
  ), ranked_sources as (
    select source_rows.*, row_number() over(partition by currency order by revenue desc,orders desc,utm_source nulls last) as position
    from source_rows
  ), daily as (
    select to_char(purchased_at at time zone v_timezone,'YYYY-MM-DD') as day,currency,sum(gross_amount) as revenue
    from sales where status in ('APPROVED','COMPLETE') group by 1,2
  ), health as (
    select code,count(*) as events from public.tracking_health
    where workspace_id=p_workspace_id and detected_at >= p_since and resolved_at is null
    group by code
  ), capi as (
    select status,test_mode,count(*) as events,sum(attempt_count) as attempts,max(last_error_code) as last_error_code
    from public.capi_delivery_diagnostics where workspace_id=p_workspace_id and updated_at >= p_since
    group by status,test_mode
  )
  select jsonb_build_object(
    'currency_summary',coalesce((select jsonb_agg(to_jsonb(summary) order by currency) from summary),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(ranked_sources)-'position' order by currency,position) from ranked_sources where position<=50),'[]'::jsonb),
    'daily_revenue',coalesce((select jsonb_agg(to_jsonb(daily) order by day,currency) from daily),'[]'::jsonb),
    'health',coalesce((select jsonb_agg(to_jsonb(health) order by code) from health),'[]'::jsonb),
    'capi',coalesce((select jsonb_agg(to_jsonb(capi) order by status,test_mode) from capi),'[]'::jsonb),
    'funnel',jsonb_build_object(
      'visits',(select count(*) from public.tracking_sessions where workspace_id=p_workspace_id and first_seen_at>=p_since),
      'page_view',(select count(*) from public.funnel_events where workspace_id=p_workspace_id and occurred_at>=p_since and event_name='page_view'),
      'view_content',(select count(*) from public.funnel_events where workspace_id=p_workspace_id and occurred_at>=p_since and event_name='view_content'),
      'checkout_click',(select count(*) from public.funnel_events where workspace_id=p_workspace_id and occurred_at>=p_since and event_name='checkout_click'),
      'checkout_started',(select count(*) from public.funnel_events where workspace_id=p_workspace_id and occurred_at>=p_since and event_name='checkout_started')
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.pulso_dashboard_metrics(uuid,timestamptz) from public,anon;
grant execute on function public.pulso_dashboard_metrics(uuid,timestamptz) to authenticated;
