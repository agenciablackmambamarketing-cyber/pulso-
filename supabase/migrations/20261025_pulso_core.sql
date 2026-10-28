-- Pulso Campanhas v2: financial ingestion, tracking and attribution foundations.
-- Apply only in the pulso-campanhas Supabase project (nlrhtioxsbncpluchfcz).
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Hashes only: Hotmart Hottok never stored as plaintext.
create table if not exists private.hotmart_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null default 'Hotmart',
  hottok_sha256 text not null unique,
  active boolean not null default true,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on private.hotmart_sources from public, anon, authenticated;
create index if not exists ix_hotmart_sources_workspace on private.hotmart_sources(workspace_id);

alter table public.sales add column if not exists sck text;
alter table public.sales add column if not exists xcod text;
alter table public.sales add column if not exists last_event_at timestamptz;
alter table public.sales add column if not exists net_amount_verified boolean not null default false;
alter table public.sales add column if not exists settlement_currency text;
alter table public.sales add column if not exists order_bump_parent text;
alter table public.sales add column if not exists payment_type text;

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'hotmart' check(provider in ('hotmart')),
  external_event_id text not null,
  transaction_id text not null,
  event_type text not null,
  status text,
  occurred_at timestamptz not null,
  accepted_for_state boolean not null default false,
  created_at timestamptz not null default now(),
  unique(workspace_id, provider, external_event_id)
);
create index if not exists ix_order_events_workspace_created on public.order_events(workspace_id,created_at desc);
create index if not exists ix_order_events_transaction on public.order_events(workspace_id,transaction_id);

create table if not exists public.tracking_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  public_session_id uuid not null,
  landing_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  gclid text,
  src text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(workspace_id,public_session_id)
);
create index if not exists ix_tracking_sessions_workspace_date on public.tracking_sessions(workspace_id,first_seen_at desc);

create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tracking_session_id uuid references public.tracking_sessions(id) on delete set null,
  event_name text not null check(event_name in ('page_view','view_content','checkout_click','checkout_started','purchase_return','custom')),
  page_url text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists ix_funnel_events_date on public.funnel_events(workspace_id,occurred_at desc);
create index if not exists ix_funnel_events_session on public.funnel_events(tracking_session_id);

create table if not exists public.attributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  tracking_session_id uuid references public.tracking_sessions(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  method text not null check (method in ('click_id','session_id','utm_match','manual','unknown')),
  confidence text not null check(confidence in ('high','medium','low','none')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(sale_id)
);
create index if not exists ix_attributions_workspace on public.attributions(workspace_id);

create table if not exists public.tracking_health (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  severity text not null check(severity in ('info','warning','error')),
  code text not null,
  description text not null,
  evidence jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists ix_tracking_health_workspace on public.tracking_health(workspace_id,detected_at desc);

create table if not exists public.financial_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  source text not null,
  external_id text,
  entry_type text not null check(entry_type in ('sale','refund','chargeback','fee','commission','adjustment','ad_spend')),
  amount numeric(14,2) not null,
  currency text not null,
  occurred_at timestamptz not null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique(workspace_id,source,external_id,entry_type)
);
create index if not exists ix_financial_ledger_workspace_date on public.financial_ledger(workspace_id,occurred_at desc);

-- Only members can read; only trusted backend can write tracking, attribution and finance.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_events','tracking_sessions','funnel_events','attributions','tracking_health','financial_ledger'] LOOP
    EXECUTE format('alter table public.%I enable row level security', t);
    EXECUTE format('revoke all on public.%I from anon, authenticated', t);
    EXECUTE format('grant select on public.%I to authenticated', t);
    EXECUTE format('drop policy if exists workspace_read on public.%I', t);
    EXECUTE format('create policy workspace_read on public.%I for select to authenticated using (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = (select auth.uid())))', t,t);
  END LOOP;
END $$;

-- Called only by the privileged server after checking the user's Supabase session.
create or replace function public.register_hotmart_source(p_workspace_id uuid, p_user_id uuid, p_label text, p_hottok text)
returns uuid
language plpgsql security definer set search_path = public,private,extensions,pg_temp
as $$
declare v_source_id uuid;
begin
  if length(coalesce(p_hottok,'')) < 12 then raise exception 'Invalid token'; end if;
  if not exists (select 1 from public.workspace_members wm
      where wm.workspace_id=p_workspace_id and wm.user_id=p_user_id and wm.role in ('owner','admin'))
  then raise exception 'Workspace access denied'; end if;
  insert into private.hotmart_sources(workspace_id,label,hottok_sha256)
  values(p_workspace_id,left(coalesce(nullif(trim(p_label),''),'Hotmart'),100),encode(digest(p_hottok,'sha256'),'hex'))
  on conflict(hottok_sha256) do update set updated_at=now()
  returning id into v_source_id;
  -- Deny cross-workspace assignment of same Hottok.
  if not exists(select 1 from private.hotmart_sources where id=v_source_id and workspace_id=p_workspace_id) then
    raise exception 'Credential is assigned to another workspace';
  end if;
  return v_source_id;
end; $$;
revoke all on function public.register_hotmart_source(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_hotmart_source(uuid,uuid,text,text) to service_role;

-- Atomic ingestion, deduplication and out-of-order status protection.
-- Event body is parsed, not persisted: buyer PII, addresses, payment details are discarded.
create or replace function public.ingest_hotmart_event(p_hottok text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public,private,extensions,pg_temp
as $$
declare
  v_workspace uuid;
  v_source uuid;
  v_event_id text := p_payload->>'id';
  v_tx text := p_payload #>> '{data,purchase,transaction}';
  v_type text := p_payload->>'event';
  v_status text;
  v_event_at timestamptz;
  v_purchased_at timestamptz;
  v_product text;
  v_product_id text;
  v_country text;
  v_curr text;
  v_gross numeric;
  v_sid uuid;
  v_eid uuid;
  v_prev_status text;
  v_prev_time timestamptz;
  v_accepted boolean;
  v_old_final boolean;
  v_new_final boolean;
  v_origin jsonb := coalesce(p_payload #> '{data,purchase,origin}','{}'::jsonb);
  v_bump text;
  v_payment_type text;
begin
  if coalesce(p_hottok,'') = '' or v_event_id is null or v_tx is null
    or coalesce(p_payload->>'version','') <> '2.0.0'
    or coalesce(v_type,'') not like 'PURCHASE_%'
  then raise exception 'Invalid Hotmart event'; end if;

  select hs.id,hs.workspace_id into v_source,v_workspace
    from private.hotmart_sources hs
    where hs.active and hs.hottok_sha256 = encode(digest(p_hottok,'sha256'),'hex');
  if v_source is null then raise exception 'Unauthorized Hotmart source'; end if;

  v_status := upper(coalesce(p_payload #>> '{data,purchase,status}',substring(v_type from 10)));
  v_event_at := to_timestamp((p_payload->>'creation_date')::numeric / 1000);
  if v_event_at is null or v_event_at > now() + interval '1 day' then
    raise exception 'Invalid event timestamp';
  end if;
  v_purchased_at := coalesce(
    case when (p_payload #>> '{data,purchase,order_date}') ~ '^[0-9]{12,}$'
      then to_timestamp((p_payload #>> '{data,purchase,order_date}')::numeric / 1000) end,
    case when (p_payload #>> '{data,purchase,approved_date}') ~ '^[0-9]{12,}$'
      then to_timestamp((p_payload #>> '{data,purchase,approved_date}')::numeric / 1000) end,
    v_event_at);
  v_gross := coalesce((p_payload #>> '{data,purchase,full_price,value}')::numeric,0);
  v_curr := upper(coalesce(p_payload #>> '{data,purchase,full_price,currency_value}',''));
  if v_curr !~ '^[A-Z]{3}$' or v_gross < 0 then raise exception 'Invalid money amount'; end if;
  v_product := left(coalesce(p_payload #>> '{data,product,name}','Produto sem nome'),250);
  v_product_id := coalesce(p_payload #>> '{data,product,ucode}', p_payload #>> '{data,product,id}');
  v_country := coalesce(p_payload #>> '{data,purchase,checkout_country,iso}',p_payload #>> '{data,buyer,address,country}');
  v_bump := p_payload #>> '{data,purchase,order_bump,parent_purchase_transaction}';
  v_payment_type := p_payload #>> '{data,purchase,payment,type}';

  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || v_tx, 0));
  insert into public.order_events(workspace_id,provider,external_event_id,transaction_id,event_type,status,occurred_at)
    values(v_workspace,'hotmart',v_event_id,v_tx,v_type,v_status,v_event_at)
    on conflict(workspace_id,provider,external_event_id) do nothing returning id into v_eid;
  if v_eid is null then return jsonb_build_object('ok',true,'duplicate',true); end if;

  select id,status,last_event_at into v_sid,v_prev_status,v_prev_time
    from public.sales where provider='hotmart' and external_transaction_id=v_tx and workspace_id=v_workspace
    for update;
  v_old_final := v_prev_status in ('REFUNDED','CHARGEBACK');
  v_new_final := v_status in ('REFUNDED','CHARGEBACK');
  v_accepted := v_sid is null or (
    v_event_at >= coalesce(v_prev_time,'epoch'::timestamptz)
    and (not v_old_final or v_new_final)
  );

  if v_sid is null then
    insert into public.sales (
      workspace_id,provider,external_transaction_id,product_id,product_name,buyer_country,
      currency,gross_amount,net_amount,net_amount_verified,status,purchased_at,src,sck,xcod,
      order_bump_parent,payment_type,last_event_at
    ) values (
      v_workspace,'hotmart',v_tx,v_product_id,v_product,v_country,
      v_curr,v_gross,0,false,v_status,v_purchased_at,
      v_origin->>'src',v_origin->>'sck',v_origin->>'xcod',v_bump,v_payment_type,v_event_at
    ) returning id into v_sid;
  elsif v_accepted then
    update public.sales set
      product_name=v_product,
      product_id=coalesce(v_product_id,product_id),
      buyer_country=coalesce(v_country,buyer_country),
      gross_amount=v_gross,
      currency=v_curr,
      status=v_status,
      purchased_at=coalesce(purchased_at,v_purchased_at),
      src=coalesce(v_origin->>'src',src),
      sck=coalesce(v_origin->>'sck',sck),
      xcod=coalesce(v_origin->>'xcod',xcod),
      order_bump_parent=coalesce(v_bump,order_bump_parent),
      payment_type=coalesce(v_payment_type,payment_type),
      last_event_at=v_event_at
    where id=v_sid;
  end if;

  update public.order_events set accepted_for_state=v_accepted where id=v_eid;
  update private.hotmart_sources set last_event_at=now() where id=v_source;

  -- A positive notification is only created when the transaction first becomes approved.
  if v_accepted and v_status in ('APPROVED','COMPLETE')
      and coalesce(v_prev_status,'') not in ('APPROVED','COMPLETE') then
    insert into public.notifications(workspace_id,user_id,type,title,body,data)
    values(v_workspace,null,'sale','Venda confirmada',v_product,
      jsonb_build_object('sale_id',v_sid,'amount',v_gross,'currency',v_curr));
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'accepted',v_accepted,'transaction',v_tx);
end; $$;
revoke all on function public.ingest_hotmart_event(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_hotmart_event(text,jsonb) to service_role;

-- Keep financial totals separate from verified net receipts.
create or replace view public.dashboard_hotmart_summary with (security_invoker=true) as
select workspace_id,currency,
 count(*) filter(where status in ('APPROVED','COMPLETE')) as confirmed_orders,
 coalesce(sum(gross_amount) filter(where status in ('APPROVED','COMPLETE')),0) as confirmed_gross_revenue,
 count(*) filter(where status in ('REFUNDED','CHARGEBACK')) as reversed_orders,
 coalesce(sum(net_amount) filter(where status in ('APPROVED','COMPLETE') and net_amount_verified),0) as verified_net_amount,
 count(*) filter(where status in ('APPROVED','COMPLETE') and net_amount_verified) as verified_net_orders
from public.sales where provider='hotmart'
group by workspace_id,currency;
grant select on public.dashboard_hotmart_summary to authenticated;

alter table private.hotmart_sources enable row level security;