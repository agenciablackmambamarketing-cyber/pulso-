import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isolatedDatabase,seedWorkspaces,ids,asUser,asRole} from './helpers.mjs';
const hotA='fixture-hotmart-source-A-only',hotB='fixture-hotmart-source-B-only';
const event=(tx,status='APPROVED',at=Date.now(),extra={})=>({id:randomUUID(),event:`PURCHASE_${status}`,version:'2.0.0',creation_date:at,data:{product:{id:123,name:'Synthetic course'},buyer:{email:'synthetic@example.invalid',checkout_phone:'+5511999999999'},purchase:{transaction:tx,status,approved_date:at,full_price:{value:149.9,currency_value:'USD'},...extra}}});
test('PostgreSQL Hotmart authenticated ingestion, privacy and financial invariants',async t=>{
 const {db,close}=await isolatedDatabase();
 try{
  await seedWorkspaces(db);
  await db.query('select public.register_hotmart_source($1,$2,$3,$4)',[ids.wa,ids.a,'Fixture A',hotA]);
  await db.query('select public.register_hotmart_source($1,$2,$3,$4)',[ids.wb,ids.b,'Fixture B',hotB]);
  const destination=(await db.query('select public.pulso_meta_save($1,$2,$3,$4) id',[ids.wa,ids.a,'1234567890123','fixture-encrypted-not-a-token'])).rows[0].id;
  const sessionA=randomUUID(),sessionOther=randomUUID(),sessionB=randomUUID();
  for(const [workspace,session,key,hash] of [[ids.wa,sessionA,'fixture_site_A','a'.repeat(64)],[ids.wa,sessionOther,'fixture_site_A','c'.repeat(64)],[ids.wb,sessionB,'fixture_site_B','b'.repeat(64)]]){
   await db.query("insert into private.tracking_sites(site_key,workspace_id,allowed_origins,consent_policy_version) values($1,$2,array['https://fixture.invalid'],'v1') on conflict do nothing",[key,workspace]);
   await db.query("insert into public.tracking_sessions(id,workspace_id,public_session_id,landing_page,utm_source) values($1,$2,$3,'https://fixture.invalid/','meta')",[session,workspace,randomUUID()]);
   await db.query("insert into private.visitor_match_context(workspace_id,tracking_session_id,marketing_allowed,legal_basis_record,consent_captured_at,consent_policy_version,expires_at) values($1,$2,true,'consent',now(),'v1',now()+interval '1 day')",[workspace,session]);
   await db.query("insert into private.tracking_handoffs(token_sha256,workspace_id,site_key,tracking_session_id,expires_at) values($1,$2,$3,$4,now()+interval '1 day')",[hash,workspace,key,session]);
  }
  const ingest=async(p,hash='a'.repeat(64),hottok=hotA)=>(await db.query('select public.ingest_hotmart_tracking_event($1,$2,$3) result',[hottok,p,hash])).rows[0].result;
  await t.test('bad Hottok and conflicting status rejected atomically',async()=>{
   await assert.rejects(ingest(event('HP_DENIED'),'a'.repeat(64),'fixture-unknown-token'),/Unauthorized/);
   const p=event('HP_BAD_STATUS');p.data.purchase.status='REFUNDED';await assert.rejects(ingest(p),/Invalid event status/);
   assert.equal((await db.query("select count(*)::int n from public.sales where external_transaction_id in ('HP_DENIED','HP_BAD_STATUS')")).rows[0].n,0);
  });
  await t.test('three duplicate webhooks create one sale, queue record and notification',async()=>{
   const p=event('HP_DEDUPE');await ingest(p);assert.equal((await ingest(p)).duplicate,true);assert.equal((await ingest(p)).duplicate,true);
   const sale=(await db.query("select id,currency,raw,src,sck,xcod from public.sales where external_transaction_id='HP_DEDUPE'")).rows[0];
   assert.equal(sale.currency,'USD');assert.deepEqual(sale.raw,{});assert.equal(sale.sck,null);assert.equal(sale.src,null);assert.equal(sale.xcod,null);
   assert.equal((await db.query('select count(*)::int n from private.conversion_event_outbox where sale_id=$1',[sale.id])).rows[0].n,1);
   const out=(await db.query('select * from private.conversion_event_outbox where sale_id=$1',[sale.id])).rows[0];
   assert.equal((await db.query("select count(*)::int n from public.notifications where data->>'sale_id'=$1",[sale.id])).rows[0].n,1);
   assert.equal(out.destination_ref,destination);assert.equal(out.test_mode,true);assert.equal(out.currency,'USD');assert.match(out.email_sha256,/^[a-f0-9]{64}$/);assert.match(out.phone_sha256,/^[a-f0-9]{64}$/);
   assert.ok(!JSON.stringify(out).includes('synthetic@example.invalid'));
  });
  await t.test('older refund wins; newer approved never resurrects sale or queue',async()=>{
   const now=Date.now();await ingest(event('HP_REVERSED','APPROVED',now));await ingest(event('HP_REVERSED','REFUNDED',now-60000));
   const again=await ingest(event('HP_REVERSED','APPROVED',now+1000));assert.equal(again.accepted,false);
   const s=(await db.query("select id,status from public.sales where external_transaction_id='HP_REVERSED'")).rows[0];assert.equal(s.status,'REFUNDED');
   assert.equal((await db.query('select status from private.conversion_event_outbox where sale_id=$1',[s.id])).rows[0].status,'failed');
   const ledger=(await db.query('select sum(amount)::numeric as total from public.financial_ledger where sale_id=$1',[s.id])).rows[0];assert.equal(Number(ledger.total),0);
   await ingest(event('HP_REVERSED','CHARGEBACK',now-120000));assert.equal((await db.query('select status from public.sales where id=$1',[s.id])).rows[0].status,'CHARGEBACK');
   assert.equal(Number((await db.query('select sum(amount) total from public.financial_ledger where sale_id=$1',[s.id])).rows[0].total),0);
  });
  await t.test('same transaction strings in two tenants cannot share session or queue',async()=>{
   await ingest(event('HP_SHARED'),'b'.repeat(64),hotA);await ingest(event('HP_SHARED'),'b'.repeat(64),hotB);
   const rows=(await db.query("select s.workspace_id,a.tracking_session_id from public.sales s join public.attributions a on a.workspace_id=s.workspace_id and a.sale_id=s.id where s.external_transaction_id='HP_SHARED' order by s.workspace_id")).rows;
   assert.equal(rows.length,2);assert.equal(rows.find(r=>r.workspace_id===ids.wa).tracking_session_id,null);assert.equal(rows.find(r=>r.workspace_id===ids.wb).tracking_session_id,sessionB);
   assert.equal((await db.query("select count(*)::int n from private.conversion_event_outbox o join public.sales s on s.id=o.sale_id where s.external_transaction_id='HP_SHARED' and o.workspace_id=$1",[ids.wa])).rows[0].n,0);
  });
  await t.test('neither stale nor subsequent accepted webhook can steal original attribution',async()=>{
   const now=Date.now();await ingest(event('HP_FIRST_TOUCH','APPROVED',now));
   assert.equal((await ingest(event('HP_FIRST_TOUCH','APPROVED',now-1000),'c'.repeat(64))).accepted,false);
   await ingest(event('HP_FIRST_TOUCH','COMPLETE',now+1000),'c'.repeat(64));
   assert.equal((await db.query("select a.tracking_session_id from public.attributions a join public.sales s on s.id=a.sale_id where s.external_transaction_id='HP_FIRST_TOUCH'")).rows[0].tracking_session_id,sessionA);
  });
  await t.test('rejected money mutation leaves accepted original untouched',async()=>{
   await ingest(event('HP_IMMUTABLE'));const p=event('HP_IMMUTABLE');p.data.purchase.full_price.value=10;
   await assert.rejects(ingest(p),/Transaction facts changed/);
   assert.equal(Number((await db.query("select gross_amount from public.sales where external_transaction_id='HP_IMMUTABLE'")).rows[0].gross_amount),149.9);
  });
  await t.test('revoked/expired handoffs and consent never produce a marketing outbox',async()=>{
   await db.query("update private.tracking_handoffs set revoked_at=now() where token_sha256=$1",['c'.repeat(64)]);
   await ingest(event('HP_REVOKED'),'c'.repeat(64));
   await db.query("update private.visitor_match_context set marketing_allowed=false where tracking_session_id=$1",[sessionA]);
   await ingest(event('HP_NO_CONSENT'));
   for(const tx of ['HP_REVOKED','HP_NO_CONSENT'])assert.equal((await db.query('select count(*)::int n from private.conversion_event_outbox o join public.sales s on s.id=o.sale_id where s.external_transaction_id=$1',[tx])).rows[0].n,0);
  });
  await t.test('dashboard roles cannot select raw origins, buyer matching or transaction IDs',async()=>{
   await assert.rejects(asUser(db,ids.a,'select raw from public.sales'),/permission denied/);
   await assert.rejects(asUser(db,ids.a,'select sck from public.sales'),/permission denied/);
   await assert.rejects(asUser(db,ids.a,'select external_transaction_id from public.sales'),/permission denied/);
   await assert.rejects(asUser(db,ids.a,'select evidence from public.attributions'),/permission denied/);
   await assert.rejects(asUser(db,ids.a,'select transaction_id from public.order_events'),/permission denied/);
   await assert.rejects(asUser(db,ids.a,'select external_id from public.financial_ledger'),/permission denied/);
   await assert.rejects(asRole(db,'anon','select gross_amount from public.sales'),/permission denied/);
  });
 }finally{await close();}
});
