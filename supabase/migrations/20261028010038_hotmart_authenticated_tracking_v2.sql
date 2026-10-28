-- Incremental patch against the audited 12-migration baseline. Never replay the
-- legacy 20261025_pulso_core.sql on an existing project. Review in staging first.
alter table public.sales add column if not exists approved_at timestamptz;

create table if not exists private.hotmart_order_context (
  sale_id uuid primary key,
  workspace_id uuid not null,
  origin_codes jsonb not null default '{}'::jsonb,
  recurrence_number integer,
  expires_at timestamptz not null default now()+interval '30 days',
  foreign key (workspace_id,sale_id) references public.sales(workspace_id,id) on delete cascade
);
alter table private.hotmart_order_context enable row level security;
revoke all on private.hotmart_order_context from public,anon,authenticated;

create or replace function public.ingest_hotmart_tracking_event(p_hottok text,p_payload jsonb,p_handoff_hash text default null)
returns jsonb language plpgsql security definer
set search_path=public,private,extensions,pg_temp
as $$
declare
 v_workspace uuid; v_source uuid;
 v_event_id text:=p_payload->>'id'; v_type text:=p_payload->>'event';
 v_tx text:=p_payload#>>'{data,purchase,transaction}';
 v_status text; v_declared text; v_event_at timestamptz; v_order_at timestamptz; v_approved_at timestamptz;
 v_product text:=p_payload#>>'{data,product,name}';
 v_product_id text:=coalesce(p_payload#>>'{data,product,ucode}',p_payload#>>'{data,product,id}');
 v_currency text:=p_payload#>>'{data,purchase,full_price,currency_value}';
 v_gross numeric; v_sale uuid; v_eid uuid; v_prior public.sales%rowtype;
 v_accepted boolean; v_session uuid; v_existing_session uuid; v_context private.visitor_match_context%rowtype;
 v_landing text; v_reason text:='missing_or_invalid_handoff'; v_count integer:=0;
 v_email text; v_phone text; v_country text; v_email_hash text; v_phone_hash text; v_country_hash text;
 v_origin jsonb:=coalesce(p_payload#>'{data,purchase,origin}','{}'::jsonb);
begin
 -- Authenticate first. No workspace, source, dataset, IP or session ID from the
 -- request body participates in tenant authorization.
 if length(coalesce(p_hottok,''))<12 or length(p_hottok)>512 then raise exception 'Unauthorized Hotmart source';end if;
 select hs.id,hs.workspace_id into v_source,v_workspace from private.hotmart_sources hs
 where hs.active and hs.hottok_sha256=encode(digest(p_hottok,'sha256'),'hex');
 if v_source is null then raise exception 'Unauthorized Hotmart source';end if;
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>128000
 or p_payload->>'version'<>'2.0.0'
 or coalesce(v_event_id,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 or coalesce(v_tx,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 then raise exception 'Invalid Hotmart event';end if;
 v_status:=case v_type
 when 'PURCHASE_APPROVED' then 'APPROVED' when 'PURCHASE_COMPLETE' then 'COMPLETE'
 when 'PURCHASE_REFUNDED' then 'REFUNDED' when 'PURCHASE_CHARGEBACK' then 'CHARGEBACK'
 when 'PURCHASE_CANCELED' then 'CANCELLED' when 'PURCHASE_EXPIRED' then 'EXPIRED'
 when 'PURCHASE_DELAYED' then 'OVERDUE' when 'PURCHASE_PROTEST' then 'PROTESTED'
 when 'PURCHASE_BILLET_PRINTED' then 'PRINTED_BILLET' else null end;
 v_declared:=p_payload#>>'{data,purchase,status}';
 v_declared:=case v_declared when 'CANCELED' then 'CANCELLED' when 'DELAYED' then 'OVERDUE' else v_declared end;
 if v_status is null or (v_declared is not null and v_declared<>v_status) then raise exception 'Invalid event status';end if;
 if coalesce(p_payload->>'creation_date','')!~'^[0-9]{12,13}$' then raise exception 'Invalid event timestamp';end if;
 v_event_at:=to_timestamp((p_payload->>'creation_date')::numeric/1000);
 if v_event_at<'2000-01-01'::timestamptz or v_event_at>now()+interval '5 minutes' then raise exception 'Invalid event timestamp';end if;
 v_order_at:=v_event_at;
 if p_payload#>>'{data,purchase,order_date}'~'^[0-9]{12,13}$' then
 v_order_at:=to_timestamp((p_payload#>>'{data,purchase,order_date}')::numeric/1000);end if;
 if p_payload#>>'{data,purchase,approved_date}' is not null then
  if p_payload#>>'{data,purchase,approved_date}'!~'^[0-9]{12,13}$' then raise exception 'Invalid event timestamp';end if;
  v_approved_at:=to_timestamp((p_payload#>>'{data,purchase,approved_date}')::numeric/1000);
  if v_approved_at<'2000-01-01'::timestamptz or v_approved_at>now()+interval '5 minutes' then raise exception 'Invalid event timestamp';end if;
 end if;
 if jsonb_typeof(p_payload#>'{data,purchase,full_price,value}')<>'number'
 or coalesce(v_currency,'')!~'^[A-Z]{3}$' then raise exception 'Invalid money amount';end if;
 v_gross:=(p_payload#>>'{data,purchase,full_price,value}')::numeric;
 if v_gross is null or v_gross<0 or v_gross>9999999999.99 then raise exception 'Invalid money amount';end if;
 if coalesce(v_product_id,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
 or coalesce(trim(v_product),'')='' or length(v_product)>250 then raise exception 'Invalid product';end if;

 perform pg_advisory_xact_lock(hashtextextended(v_workspace::text||':hotmart:'||v_tx,0));
 insert into public.order_events(workspace_id,provider,external_event_id,transaction_id,event_type,status,occurred_at)
 values(v_workspace,'hotmart',v_event_id,v_tx,v_type,v_status,v_event_at)
 on conflict(workspace_id,provider,external_event_id) do nothing returning id into v_eid;
 if v_eid is null then return jsonb_build_object('ok',true,'duplicate',true,'accepted',false);end if;
 select * into v_prior from public.sales where workspace_id=v_workspace and provider='hotmart' and external_transaction_id=v_tx for update;
 v_sale:=v_prior.id;
 -- Terminal reversal is monotonic, even if the refund notification is delayed.
 -- COMPLETE cannot regress to APPROVED, and paid orders cannot become pending.
 v_accepted:=v_sale is null or case
  when v_prior.status='CHARGEBACK' then false
  when v_prior.status='REFUNDED' then v_status='CHARGEBACK'
  when v_status in ('REFUNDED','CHARGEBACK') then true
  when v_prior.status in ('APPROVED','COMPLETE') and v_status not in ('APPROVED','COMPLETE') then false
  when v_prior.status='COMPLETE' and v_status='APPROVED' then false
  else v_event_at>=coalesce(v_prior.last_event_at,'epoch'::timestamptz) end;
 if v_sale is not null and (v_prior.currency is distinct from v_currency or v_prior.gross_amount is distinct from v_gross
 or v_prior.product_id is distinct from v_product_id) then raise exception 'Transaction facts changed';end if;

 if v_sale is null then
  insert into public.sales(workspace_id,provider,external_transaction_id,product_id,product_name,buyer_country,
   currency,gross_amount,net_amount,net_amount_verified,status,purchased_at,approved_at,last_event_at,order_bump_parent,payment_type)
  values(v_workspace,'hotmart',v_tx,v_product_id,v_product,null,v_currency,v_gross,0,false,v_status,v_order_at,
   case when v_status in ('APPROVED','COMPLETE') then coalesce(v_approved_at,v_event_at) end,v_event_at,
   left(p_payload#>>'{data,purchase,order_bump,parent_purchase_transaction}',128),left(p_payload#>>'{data,purchase,payment,type}',50))
  returning id into v_sale;
 elsif v_accepted then
  update public.sales set status=v_status,last_event_at=greatest(v_event_at,last_event_at),
   approved_at=coalesce(approved_at,case when v_status in ('APPROVED','COMPLETE') then coalesce(v_approved_at,v_event_at) end)
  where workspace_id=v_workspace and id=v_sale;
 end if;
 update public.order_events set accepted_for_state=v_accepted where id=v_eid;
 update private.hotmart_sources set last_event_at=now() where id=v_source;
 -- The existing mark_hotmart_connected trigger updates integration status.
 -- Retain only allowlisted origin codes privately; never the full webhook/buyer.
 insert into private.hotmart_order_context(workspace_id,sale_id,origin_codes,recurrence_number)
 values(v_workspace,v_sale,jsonb_strip_nulls(jsonb_build_object('src',left(v_origin->>'src',250),'sck',left(v_origin->>'sck',250),'xcod',left(v_origin->>'xcod',250))),
 case when p_payload#>>'{data,purchase,recurrence_number}'~'^[0-9]{1,6}$' then (p_payload#>>'{data,purchase,recurrence_number}')::integer end)
 on conflict(sale_id) do nothing;
 if not v_accepted then return jsonb_build_object('ok',true,'duplicate',false,'accepted',false,'queued',0);end if;

 -- The Edge Function supplies a digest only after HMAC verification. This RPC is
 -- service-role only; a valid digest must also belong to this Hotmart workspace.
 if p_handoff_hash~'^[0-9a-f]{64}$' then
  select h.tracking_session_id into v_session from private.tracking_handoffs h
  where h.workspace_id=v_workspace and h.token_sha256=p_handoff_hash and h.expires_at>now() and h.revoked_at is null;
  if v_session is not null then
   select * into v_context from private.visitor_match_context c
   where c.workspace_id=v_workspace and c.tracking_session_id=v_session and c.expires_at>now()
   and c.marketing_allowed and c.consent_captured_at is not null and c.consent_policy_version is not null
   and c.legal_basis_record is not null for update;
   if v_context.id is null then v_session:=null;v_reason:='consent_missing_revoked_or_expired';
   else v_reason:='signed_session';end if;
  else v_reason:='handoff_unknown_cross_tenant_expired_or_revoked';end if;
 end if;
 -- Existing valid attribution is not lost when later status notifications omit
 -- the origin. Its consent is re-checked below before creating delivery work.
 if v_session is null then
  select a.tracking_session_id into v_session from public.attributions a
  join private.visitor_match_context c on c.workspace_id=a.workspace_id and c.tracking_session_id=a.tracking_session_id
  where a.workspace_id=v_workspace and a.sale_id=v_sale and c.marketing_allowed and c.expires_at>now()
  and c.consent_captured_at is not null and c.consent_policy_version is not null and c.legal_basis_record is not null;
  if v_session is not null then
   select * into v_context from private.visitor_match_context c where c.workspace_id=v_workspace and c.tracking_session_id=v_session for update;
  end if;
 end if;
 -- Attribution is first verified session, never last webhook wins. Even a
 -- different valid handoff cannot steal an already attributed transaction.
 select a.tracking_session_id into v_existing_session from public.attributions a
 where a.workspace_id=v_workspace and a.sale_id=v_sale;
 if v_existing_session is not null then
  v_session:=v_existing_session;
  select * into v_context from private.visitor_match_context c
  where c.workspace_id=v_workspace and c.tracking_session_id=v_session and c.marketing_allowed
  and c.expires_at>now() and c.consent_captured_at is not null and c.consent_policy_version is not null
  and c.legal_basis_record is not null for update;
  if v_context.id is null then v_session:=null;end if;
 end if;
 insert into public.attributions(workspace_id,sale_id,tracking_session_id,method,confidence,evidence)
 values(v_workspace,v_sale,v_session,case when v_session is null then 'unknown' else 'session_id' end,
 case when v_session is null then 'none' else 'high' end,jsonb_build_object('reason',v_reason))
 on conflict(sale_id) do update set tracking_session_id=coalesce(attributions.tracking_session_id,excluded.tracking_session_id),
 method=case when excluded.tracking_session_id is not null then 'session_id' else attributions.method end,
 confidence=case when excluded.tracking_session_id is not null then 'high' else attributions.confidence end,
 evidence=case when excluded.tracking_session_id is not null then excluded.evidence else attributions.evidence end;
 if v_session is not null then
  update public.sales s set utm_source=t.utm_source,utm_medium=t.utm_medium,utm_campaign=t.utm_campaign,utm_content=null
  from public.tracking_sessions t where s.workspace_id=v_workspace and s.id=v_sale and t.workspace_id=v_workspace and t.id=v_session;
  select landing_page into v_landing from public.tracking_sessions where workspace_id=v_workspace and id=v_session;
 end if;
 if v_accepted and v_status in ('REFUNDED','CHARGEBACK') then
  update private.conversion_event_outbox set status='failed',last_error_code='sale_reversed',updated_at=now()
  where workspace_id=v_workspace and sale_id=v_sale and status<>'delivered';
 end if;
 if v_accepted and v_status in ('APPROVED','COMPLETE') then
  insert into public.financial_ledger(workspace_id,sale_id,source,external_id,entry_type,amount,currency,occurred_at,verified)
  values(v_workspace,v_sale,'hotmart',v_tx,'sale',v_gross,v_currency,coalesce(v_approved_at,v_event_at),true)
  on conflict(workspace_id,source,external_id,entry_type) do nothing;
  if coalesce(v_prior.status,'') not in ('APPROVED','COMPLETE') then
   insert into public.notifications(workspace_id,user_id,type,title,body,data)
   values(v_workspace,null,'sale','Venda confirmada',v_product,jsonb_build_object('sale_id',v_sale,'amount',v_gross,'currency',v_currency));
  end if;
  if v_context.id is not null and v_session is not null then
   -- Only matching keys supported and normalized unambiguously are retained;
   -- no name, document, address or payment data is persisted. Hash != anonymous.
   v_email:=lower(trim(p_payload#>>'{data,buyer,email}'));
   if length(v_email)<=254 and v_email~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then v_email_hash:=encode(digest(v_email,'sha256'),'hex');end if;
   -- E.164 only. Never guess a country calling code for a local phone number.
   v_phone:=p_payload#>>'{data,buyer,checkout_phone}';
   if v_phone~'^\+[1-9][0-9]{7,14}$' then v_phone_hash:=encode(digest(substring(v_phone from 2),'sha256'),'hex');end if;
   v_country:=lower(p_payload#>>'{data,purchase,checkout_country,iso}');
   if v_country~'^[a-z]{2}$' then v_country_hash:=encode(digest(v_country,'sha256'),'hex');end if;
   insert into private.conversion_event_outbox(workspace_id,destination_ref,sale_id,provider,event_name,event_id,event_time,event_source_url,
    product_id,value,currency,fbp,fbc,client_ip,client_user_agent,marketing_allowed,consent_basis,consent_captured_at,
    email_sha256,phone_sha256,country_sha256,tracking_session_id,test_mode)
   select v_workspace,d.id,v_sale,'meta','Purchase',encode(digest(v_workspace::text||':hotmart:'||v_tx||':Purchase','sha256'),'hex'),
    coalesce(s.approved_at,v_approved_at,v_event_at),v_landing,v_product_id,v_gross,v_currency,v_context.fbp,v_context.fbc,
    v_context.client_ip,v_context.client_user_agent,true,v_context.legal_basis_record,v_context.consent_captured_at,
    v_email_hash,v_phone_hash,v_country_hash,v_session,true
   from public.conversion_destinations d join public.integrations i on i.workspace_id=d.workspace_id and i.id=d.integration_id and i.provider=d.provider
   join public.sales s on s.workspace_id=d.workspace_id and s.id=v_sale
   where d.workspace_id=v_workspace and d.provider='meta' and d.is_active and i.status='connected'
   and s.status in ('APPROVED','COMPLETE')
   on conflict(workspace_id,destination_ref,event_name,event_id) do nothing;
   get diagnostics v_count=row_count;
  end if;
  if v_session is null then
   insert into public.tracking_health(workspace_id,severity,code,description,evidence)
   values(v_workspace,'warning','purchase_unattributed','Compra sem sessão consentida verificável.',jsonb_build_object('reason',v_reason));
  end if;
 elsif v_accepted and v_status in ('REFUNDED','CHARGEBACK') then
  -- One reversal ledger entry per transaction; do not double debit a later
  -- chargeback for a purchase which was already fully refunded.
  insert into public.financial_ledger(workspace_id,sale_id,source,external_id,entry_type,amount,currency,occurred_at,verified)
  values(v_workspace,v_sale,'hotmart',v_tx,'refund',-v_gross,v_currency,v_event_at,true)
  on conflict(workspace_id,source,external_id,entry_type) do nothing;
 end if;
 return jsonb_build_object('ok',true,'duplicate',false,'accepted',v_accepted,'queued',v_count);
end;$$;
revoke all on function public.ingest_hotmart_tracking_event(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_hotmart_tracking_event(text,jsonb,text) to service_role;

-- Compatibility for callers on the old endpoint: financial ingestion continues,
-- but no signed-handoff attribution is trusted without the new Edge verification.
create or replace function public.ingest_hotmart_event(p_hottok text,p_payload jsonb)
returns jsonb language sql security definer set search_path=public,private,extensions,pg_temp
as $$select public.ingest_hotmart_tracking_event(p_hottok,p_payload,null);$$;
revoke all on function public.ingest_hotmart_event(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_hotmart_event(text,jsonb) to service_role;

create or replace function public.pulso_purge_hotmart_context()
returns bigint language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_count bigint;begin
 delete from private.hotmart_order_context where expires_at<now();get diagnostics v_count=row_count;return v_count;
end;$$;
revoke all on function public.pulso_purge_hotmart_context() from public,anon,authenticated;
grant execute on function public.pulso_purge_hotmart_context() to service_role;

-- Remove both table-wide and historical column grants before granting the
-- dashboard's minimum safe financial fields. RLS still controls workspace rows.
revoke select on public.sales,public.attributions from anon,authenticated;
do $$declare columns text;table_name text;begin
 foreach table_name in array array['sales','attributions'] loop
  select string_agg(quote_ident(attname),',') into columns from pg_attribute
  where attrelid=format('public.%I',table_name)::regclass and attnum>0 and not attisdropped;
  execute format('revoke select(%s) on public.%I from anon,authenticated',columns,table_name);
 end loop;
end;$$;
grant select(id,workspace_id,provider,product_id,product_name,currency,gross_amount,net_amount,net_amount_verified,status,purchased_at,approved_at,last_event_at,created_at,settlement_currency)
 on public.sales to authenticated;
grant select(id,workspace_id,sale_id,tracking_session_id,campaign_id,method,confidence,created_at)
 on public.attributions to authenticated;
-- Original order/webhook identifiers remain backend-only as well, including
-- legacy records, while dashboard counts/financial amounts stay tenant scoped.
revoke select on public.order_events,public.financial_ledger from anon,authenticated;
do $$declare columns text;table_name text;begin
 foreach table_name in array array['order_events','financial_ledger'] loop
  select string_agg(quote_ident(attname),',') into columns from pg_attribute
  where attrelid=format('public.%I',table_name)::regclass and attnum>0 and not attisdropped;
  execute format('revoke select(%s) on public.%I from anon,authenticated',columns,table_name);
 end loop;
end;$$;
grant select(id,workspace_id,provider,event_type,status,occurred_at,accepted_for_state,created_at) on public.order_events to authenticated;
grant select(id,workspace_id,sale_id,source,entry_type,amount,currency,occurred_at,verified,created_at) on public.financial_ledger to authenticated;
