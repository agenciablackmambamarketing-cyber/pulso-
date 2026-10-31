-- Synthetic checks for the new isolated project. All fixture changes roll back.
begin;
set local statement_timeout='25s';
do $$
declare
 ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid();
 wa uuid:=gen_random_uuid(); wb uuid:=gen_random_uuid();
 tok_a text:='fixture-token-a-'||gen_random_uuid()::text;
 tok_b text:='fixture-token-b-'||gen_random_uuid()::text;
 tx text:='PULSO-SYNTHETIC-'||gen_random_uuid()::text;
 ms bigint:=floor(extract(epoch from now())*1000)::bigint;
 event jsonb; result jsonb; v_sale_id uuid; denied boolean:=false;
begin
 insert into auth.users(id,raw_user_meta_data) values(ua,'{}'),(ub,'{}');
 insert into public.workspaces(id,name,slug,owner_id)
 values(wa,'PULSO_TX_CHECK_A','pulso-tx-'||wa::text,ua),
       (wb,'PULSO_TX_CHECK_B','pulso-tx-'||wb::text,ub);
 perform public.register_hotmart_source(wa,ua,'Synthetic A',tok_a);
 perform public.register_hotmart_source(wb,ub,'Synthetic B',tok_b);
 event:=jsonb_build_object('id',gen_random_uuid()::text,'event','PURCHASE_APPROVED','version','2.0.0','creation_date',ms,
   'data',jsonb_build_object('product',jsonb_build_object('id',123,'name','Synthetic course'),
     'buyer',jsonb_build_object('email','fake@example.invalid'),
     'purchase',jsonb_build_object('transaction',tx,'status','APPROVED','approved_date',ms,
       'full_price',jsonb_build_object('value',149.90,'currency_value','BRL'))));
 begin
   perform public.ingest_hotmart_tracking_event('not-a-real-token',event,null);
 exception when others then
   if sqlerrm like 'Unauthorized Hotmart source%' then denied:=true; else raise; end if;
 end;
 if not denied then raise exception 'Invalid Hotmart token was accepted'; end if;
 result:=public.ingest_hotmart_tracking_event(tok_a,event,null);
 if result->>'accepted' is distinct from 'true' or result->>'queued' is distinct from '0' then
   raise exception 'Synthetic approval failed or created a conversion without consent';
 end if;
 result:=public.ingest_hotmart_tracking_event(tok_a,event,null);
 if result->>'duplicate' is distinct from 'true' then raise exception 'Duplicate webhook was accepted twice'; end if;
 select id into strict v_sale_id from public.sales where workspace_id=wa and external_transaction_id=tx;
 if exists(select 1 from public.sales where id=v_sale_id and (raw<>'{}'::jsonb or currency<>'BRL' or gross_amount<>149.90)) then
   raise exception 'Financial or privacy invariant failed';
 end if;
 event:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(event,'{id}',to_jsonb(gen_random_uuid()::text)),
   '{event}','"PURCHASE_REFUNDED"'),'{data,purchase,status}','"REFUNDED"'),'{creation_date}',to_jsonb(ms-60000));
 result:=public.ingest_hotmart_tracking_event(tok_a,event,null);
 if result->>'accepted' is distinct from 'true' then raise exception 'Older refund was not accepted'; end if;
 event:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(event,'{id}',to_jsonb(gen_random_uuid()::text)),
   '{event}','"PURCHASE_APPROVED"'),'{data,purchase,status}','"APPROVED"'),'{creation_date}',to_jsonb(ms));
 result:=public.ingest_hotmart_tracking_event(tok_a,event,null);
 if result->>'accepted' is distinct from 'false'
   or (select status from public.sales where id=v_sale_id) is distinct from 'REFUNDED'
   or (select sum(amount) from public.financial_ledger where sale_id=v_sale_id) is distinct from 0::numeric then
   raise exception 'Refund or ledger invariant failed';
 end if;
 event:=jsonb_set(event,'{id}',to_jsonb(gen_random_uuid()::text));
 result:=public.ingest_hotmart_tracking_event(tok_b,event,null);
 if result->>'accepted' is distinct from 'true'
   or (select count(*) from public.sales where external_transaction_id=tx)<>2 then
   raise exception 'Same transaction did not remain isolated between workspaces';
 end if;
 perform set_config('pulso_test.ua',ua::text,true);
 perform set_config('pulso_test.ub',ub::text,true);
 perform set_config('pulso_test.wa',wa::text,true);
 perform set_config('pulso_test.wb',wb::text,true);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('pulso_test.ua'),true);
do $$
declare a uuid:=current_setting('pulso_test.wa')::uuid; b uuid:=current_setting('pulso_test.wb')::uuid; denied boolean:=false;
begin
 if (select count(*) from public.workspaces where id in(a,b))<>1 then raise exception 'Workspace isolation failed'; end if;
 perform public.configure_tracking_site(a,'fixture_site_a',array['https://example.invalid'],'v1');
 begin
   perform public.configure_tracking_site(b,'fixture_site_b',array['https://example.invalid'],'v1');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Cross-workspace configuration accepted'; end if;
 denied:=false;
 begin perform 1 from private.hotmart_sources; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Private source table was accessible'; end if;
 denied:=false;
 begin perform raw from public.sales; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Raw sales data was accessible'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('pulso_test.ub'),true);
do $$
declare b uuid:=current_setting('pulso_test.wb')::uuid; denied boolean:=false;
begin
 begin
  perform public.configure_tracking_site(b,'fixture_site_a',array['https://attacker.invalid'],'v1');
 exception when unique_violation then denied:=true; end;
 if not denied then raise exception 'A site key belonging to another workspace was overwritten'; end if;
 perform public.configure_tracking_site(b,'fixture_site_b',array['https://example.invalid'],'v1');
end $$;
reset role;
set local role anon;
do $$
declare denied boolean:=false;
begin
 begin perform public.configure_tracking_site(current_setting('pulso_test.wa')::uuid,'anon_site',array['https://example.invalid'],'v1');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous configuration accepted'; end if;
end $$;
reset role;
rollback;
select count(*) as remaining_synthetic_workspaces from public.workspaces where name in('PULSO_TX_CHECK_A','PULSO_TX_CHECK_B');
