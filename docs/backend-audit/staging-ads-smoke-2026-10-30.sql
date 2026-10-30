-- STAGING ONLY: synthetic transactional smoke for Meta Ads / media ROI.
-- Run after 20261029124537_pulso_meta_ads_read_cache.sql using an authorized
-- database admin session. Never run against production. No external provider call.
-- Fake ciphertext below is structural test data, not a real usable credential.
-- One SQL request includes BEGIN + all checks + ROLLBACK. Any assertion failure
-- aborts the transaction; explicitly ROLLBACK before reusing that connection.
begin;
set local statement_timeout = '25s';
set local lock_timeout = '3s';

do $$
declare
 ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid();
 wa uuid:=gen_random_uuid(); wb uuid:=gen_random_uuid(); conn uuid;
 account jsonb:=jsonb_build_object('id','987654321099999999','name','SYNTHETIC smoke account',
   'currency','BRL','timezone_name','America/Sao_Paulo','account_status',1);
 sealed text:=jsonb_build_object('v',1,'iv',encode(decode(repeat('01',12),'hex'),'base64'),
   'data',encode(decode(repeat('02',32),'hex'),'base64'))::text;
 latest date:=(now() at time zone 'America/Sao_Paulo')::date-1;
 lease jsonb; snapshot jsonb;
begin
 if to_regprocedure('public.pulso_ads_metrics(uuid,date,date)') is null then
  raise exception 'Ads migration is not present';
 end if;
 insert into auth.users(id,raw_user_meta_data) values(ua,'{}'),(ub,'{}');
 insert into public.workspaces(id,name,slug,owner_id,timezone,currency)
 values(wa,'PULSO_ADS_SYNTHETIC_SMOKE_A','pulso-ads-smoke-'||wa::text,ua,'America/Sao_Paulo','BRL'),
       (wb,'PULSO_ADS_SYNTHETIC_SMOKE_B','pulso-ads-smoke-'||wb::text,ub,'America/Sao_Paulo','BRL');
 conn:=public.pulso_ads_save(wa,ua,account,sealed);
 lease:=public.pulso_ads_begin_sync(wa,ua,conn);
 snapshot:=jsonb_build_object(
  'account',account,
  'campaigns',jsonb_build_array(
   jsonb_build_object('id','987654321099999991','name','SYNTHETIC active','status','ACTIVE','effective_status','ACTIVE','objective','OUTCOME_SALES'),
   jsonb_build_object('id','987654321099999992','name','SYNTHETIC paused','status','PAUSED','effective_status','PAUSED','objective','OUTCOME_SALES')),
  'daily',(select jsonb_agg(jsonb_build_object('campaign_id',c.id,'date',d::date,'spend',c.spend,'impressions',100,'clicks',10))
    from generate_series((latest-2)::timestamp,latest::timestamp,interval '1 day') d
    cross join(values('987654321099999991','12'),('987654321099999992','8')) c(id,spend)),
  'account_daily',(select jsonb_agg(jsonb_build_object('date',d::date,'spend',case when d::date=latest-3 then '0' else '20' end))
    from generate_series((latest-3)::timestamp,latest::timestamp,interval '1 day') d));
 perform public.pulso_ads_complete_sync(wa,conn,(lease->>'lease_id')::uuid,latest-3,latest,snapshot);
 -- Latest day: two sales sources, total60 / media20 -> +200%.
 -- Previous day: two sales sources, total20 / media20 ->0%.
 -- Two days before: no approved sales / media20 -> -100%.
 -- Three days before: complete zero spend -> ROI unknown (NULL).
 insert into public.sales(workspace_id,provider,external_transaction_id,currency,gross_amount,status,purchased_at)
 select wa,p.provider,'SYNTHETIC-SMOKE-'||gen_random_uuid()::text,'BRL',p.gross,p.status,
   (p.day+interval '12 hours') at time zone 'America/Sao_Paulo'
 from(values('hotmart',50::numeric,'APPROVED',latest),
            ('synthetic_other_platform',10::numeric,'APPROVED',latest),
            ('hotmart',10::numeric,'APPROVED',latest-1),
            ('synthetic_other_platform',10::numeric,'APPROVED',latest-1),
            ('hotmart',1000::numeric,'REFUNDED',latest),
            ('synthetic_other_platform',1000::numeric,'CHARGEBACK',latest)) p(provider,gross,status,day);
 perform set_config('pulso_smoke.ua',ua::text,true);
 perform set_config('pulso_smoke.ub',ub::text,true);
 perform set_config('pulso_smoke.wa',wa::text,true);
 perform set_config('pulso_smoke.wb',wb::text,true);
 perform set_config('pulso_smoke.latest',latest::text,true);
 perform set_config('pulso_smoke.conn',conn::text,true);
 if exists(select 1 from private.conversion_event_outbox where workspace_id in(wa,wb)) then
  raise exception 'Synthetic smoke must not create conversion jobs';
 end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('pulso_smoke.ua'),true) is not null as synthetic_identity_set;
do $$
declare
 wa uuid:=current_setting('pulso_smoke.wa')::uuid;
 wb uuid:=current_setting('pulso_smoke.wb')::uuid;
 day date:=current_setting('pulso_smoke.latest')::date;
 report jsonb; row jsonb; blocked boolean;
begin
 report:=public.pulso_ads_metrics(wa,day,day);
 select value into row from jsonb_array_elements(report->'financial') where value->>'currency'='BRL';
 if report->'media_providers' is distinct from '["meta"]'::jsonb
 or report->>'revenue_scope' is distinct from 'all_recorded_sales'
 or row->>'complete' is distinct from 'true'
 or (row->>'approved_revenue')::numeric is distinct from 60
 or (row->>'media_spend')::numeric is distinct from 20
 or (row->>'refunded_orders')::integer is distinct from 2
 or (row->>'media_roi_percent')::numeric is distinct from 200
 or row->'profit' is distinct from 'null'::jsonb
 or row->'roi_percent' is distinct from 'null'::jsonb then
  raise exception 'Positive/multi-provider/refund/unknown-profit assertion failed';
 end if;
 if jsonb_array_length(report->'campaigns')<>2
 or not exists(select 1 from jsonb_array_elements(report->'campaigns') c where c->>'effective_status'='PAUSED' and (c->>'spend')::numeric=8) then
  raise exception 'Paused spend must remain part of account total';
 end if;
 report:=public.pulso_ads_metrics(wa,day-1,day-1);
 if (report#>>'{financial,0,media_roi_percent}')::numeric is distinct from 0 then raise exception 'Zero ROI assertion failed';end if;
 report:=public.pulso_ads_metrics(wa,day-2,day-2);
 if (report#>>'{financial,0,media_roi_percent}')::numeric is distinct from -100 then raise exception 'Negative ROI assertion failed';end if;
 report:=public.pulso_ads_metrics(wa,day-3,day-3);
 if report#>'{financial,0,media_roi_percent}' is distinct from 'null'::jsonb
 or (report#>>'{financial,0,media_spend}')::numeric is distinct from 0
 or report#>>'{financial,0,complete}' is distinct from 'true' then raise exception 'Complete zero spend must have unknown ROI';end if;
 report:=public.pulso_ads_metrics(wa,day-4,day);
 if report#>'{financial,0,media_roi_percent}' is distinct from 'null'::jsonb
 or report#>'{financial,0,media_spend}' is distinct from 'null'::jsonb then raise exception 'Missing coverage must not invent ROI/spend';end if;
 blocked:=false;
 begin perform public.pulso_ads_metrics(wb,day,day);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Cross-workspace metrics were accessible';end if;
 blocked:=false;
 begin perform 1 from private.meta_ads_credentials;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Private credentials were accessible';end if;
 blocked:=false;
 begin perform public.pulso_ads_begin_sync(wa,current_setting('pulso_smoke.ua')::uuid,current_setting('pulso_smoke.conn')::uuid);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Authenticated role executed a service-only mutation';end if;
 if (select count(*) from public.meta_ads_accounts where workspace_id in(wa,wb))<>1 then raise exception 'Own-account RLS failed';end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('pulso_smoke.ub'),true) is not null as other_synthetic_identity_set;
do $$
declare day date:=current_setting('pulso_smoke.latest')::date;report jsonb;blocked boolean:=false;
begin
 report:=public.pulso_ads_metrics(current_setting('pulso_smoke.wb')::uuid,day,day);
 if report->'accounts' is distinct from '[]'::jsonb or report->'financial' is distinct from '[]'::jsonb then raise exception 'Empty tenant received another tenant data';end if;
 if exists(select 1 from public.meta_ads_accounts where workspace_id=current_setting('pulso_smoke.wa')::uuid) then raise exception 'RLS exposed another tenant account';end if;
 begin perform public.pulso_ads_metrics(current_setting('pulso_smoke.wa')::uuid,day,day);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Second identity read another tenant metrics';end if;
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true) is not null as anonymous_identity_cleared;
do $$
declare day date:=current_setting('pulso_smoke.latest')::date;blocked boolean:=false;
begin
 begin perform public.pulso_ads_metrics(current_setting('pulso_smoke.wa')::uuid,day,day);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Anonymous metrics execution allowed';end if;
end $$;
reset role;

do $$
begin
 if exists(select 1 from pg_proc where oid='public.pulso_ads_metrics(uuid,date,date)'::regprocedure and prosecdef) then raise exception 'Public metrics wrapper must be invoker';end if;
 if has_schema_privilege('authenticated','private','USAGE')
 or has_table_privilege('authenticated','private.meta_ads_credentials','SELECT')
 or has_function_privilege('authenticated','public.pulso_ads_begin_sync(uuid,uuid,uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.pulso_ads_begin_sync(uuid,uuid,uuid)','EXECUTE') then raise exception 'Unexpected privileged grants';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','private') and c.relkind in ('r','p') and c.relname like 'meta_ads_%' and not c.relrowsecurity) then raise exception 'Ads relation missing RLS';end if;
end $$;
select jsonb_build_object('synthetic_only',true,'tenant_isolation',true,'anonymous_denied',true,
 'private_credentials_denied',true,'service_only_mutation_denied',true,'roi_positive',200,
 'roi_zero',0,'roi_negative',-100,'zero_spend_roi_null',true,'missing_coverage_null',true,
 'revenue_all_recorded_providers',true,'reversed_sales_excluded',true,'paused_spend_included',true,
 'real_provider_requests',0,'conversion_jobs',0,'rollback_follows',true) as smoke_result;
rollback;
select count(*) as remaining_synthetic_workspaces from public.workspaces where name in('PULSO_ADS_SYNTHETIC_SMOKE_A','PULSO_ADS_SYNTHETIC_SMOKE_B');
