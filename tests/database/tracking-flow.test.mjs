import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isolatedDatabase, seedWorkspaces, asUser, asRole, ids } from './helpers.mjs';
import { createCollector } from '../../supabase/functions/_shared/collector.mjs';
import { createHotmartHandler } from '../../supabase/functions/_shared/hotmart.mjs';
import { mintHandoff, verifyHandoff, sha256 } from '../../supabase/functions/_shared/handoff.mjs';
import { sealCredential } from '../../supabase/functions/_shared/meta.mjs';
import { handleMetaWorker } from '../../supabase/functions/_shared/meta-worker.mjs';

const enabled=!!process.env.PULSO_TEST_DATABASE_URL;
test('first-party → authenticated Hotmart → transactional outbox → mocked Meta → tenant dashboard (PostgreSQL)',{skip:!enabled},async t=>{
 const fixture=await isolatedDatabase();const {db}=fixture;
 try{
  await seedWorkspaces(db);
  const key='synthetic-handoff-key-that-is-longer-than-32-bytes';
  const credentialKey=Buffer.alloc(32,23).toString('base64');
  const workerSecret='synthetic-worker-secret-over-32-characters';
  const siteKey='synthetic_site_a';const origin='https://ingles.example.test';
  const serviceRpc=async(name,args)=>{
   assert.match(name,/^[a-z_]+$/);const keys=Object.keys(args);keys.forEach(k=>assert.match(k,/^[a-z_]+$/));
   await db.query('begin');
   try{
    await db.query('set local role service_role');
    const result=await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,Object.values(args));
    await db.query('commit');return result.rows[0].result;
   }catch(error){await db.query('rollback');throw error;}
  };
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.a]);
  await db.query('select public.configure_tracking_site($1,$2,$3,$4)',[ids.wa,siteKey,[origin],'fixture-v1']);
  const collector=createCollector({rpc:serviceRpc,handoffKey:key,ipHashKey:'fixture-rate-key'});
  const capture=async(eventName,resume,eventId=randomUUID())=>{
   const input={site_key:siteKey,event_id:eventId,event_name:eventName,page_url:origin+'/',click:{utm_source:'meta',utm_medium:'cpc',utm_campaign:'ingles_fixture',fbclid:'synthetic_click'},browser:{fbp:'fb.1.1700000000.synthetic',fbc:null},consent:{marketing:true,policy_version:'fixture-v1',captured_at:new Date().toISOString(),basis:'consent'}};
   if(resume)input.resume_token=resume;
   return collector(new Request(`https://collector.example.test/?site_key=${siteKey}`,{method:'POST',headers:{origin,'content-type':'application/json','user-agent':'Synthetic test browser'},body:JSON.stringify(input)}));
  };
  let handoff;
  await t.test('collect only consented registered origin; do not retain untrusted IP',async()=>{
   const response=await capture('page_view');assert.equal(response.status,200);const body=await response.json();handoff=body.checkout_handoff_token;
   assert.equal(await verifyHandoff(handoff,key),true);assert.equal(handoff.length,30);
   const contexts=await db.query('select client_ip,marketing_allowed from private.visitor_match_context');assert.equal(contexts.rows.length,1);assert.equal(contexts.rows[0].client_ip,null);assert.equal(contexts.rows[0].marketing_allowed,true);
   const checkout=await capture('checkout_started',handoff);assert.equal(checkout.status,200);
   const token2=(await checkout.json()).checkout_handoff_token;
   assert.equal((await db.query('select count(*)::int n from public.tracking_sessions')).rows[0].n,1);
   assert.equal((await db.query('select count(*)::int n from public.funnel_events')).rows[0].n,2);
   assert.ok(token2);
  });
  await t.test('role boundaries: sensitive fields, private schema and service RPCs denied; tenant RLS enforced',async()=>{
   for(const column of ['raw','src','sck','xcod'])await assert.rejects(asUser(db,ids.a,`select ${column} from public.sales`),/permission denied/);
   for(const column of ['fbclid','gclid','tblci','gbraid','wbraid','public_session_id'])await assert.rejects(asUser(db,ids.a,`select ${column} from public.tracking_sessions`),/permission denied/);
   await assert.rejects(asUser(db,ids.a,'select * from private.visitor_match_context'),/permission denied/);
   await assert.rejects(asRole(db,'anon','select id from public.sales'),/permission denied/);
   await assert.rejects(asUser(db,ids.a,'select public.pulso_meta_claim(10)'),/permission denied/);
   await assert.rejects(asUser(db,ids.b,'select public.configure_tracking_site($1,$2,$3,$4)',[ids.wa,'fake_site_b',[origin],'v1']),/Workspace access denied/);
   assert.equal((await asUser(db,ids.b,'select id from public.tracking_sessions')).rows.length,0);
   await assert.rejects(asUser(db,ids.b,'select public.pulso_dashboard_metrics($1,now()-interval \'1 day\')',[ids.wa]),/Workspace access denied/);
  });
  const hottokA='fixture_hottok_workspace_a';const hottokB='fixture_hottok_workspace_b';
  await serviceRpc('register_hotmart_source',{p_workspace_id:ids.wa,p_user_id:ids.a,p_label:'Fixture A',p_hottok:hottokA});
  await serviceRpc('register_hotmart_source',{p_workspace_id:ids.wb,p_user_id:ids.b,p_label:'Fixture B',p_hottok:hottokB});
  const dataset='123456789012345';
  const sealed=await sealCredential({dataset_id:dataset,access_token:'synthetic-meta-token-never-real',mode:'test',test_event_code:'TEST_SYNTHETIC'},ids.wa,dataset,credentialKey);
  const destination=await serviceRpc('pulso_meta_save',{p_workspace_id:ids.wa,p_user_id:ids.a,p_dataset_id:dataset,p_ciphertext:sealed,p_mode:'test'});
  const webhook=createHotmartHandler({rpc:async(name,args)=>{try{return{data:await serviceRpc(name,args),error:null};}catch(error){return{data:null,error};}},verifyHandoff,sha256,handoffKey:key});
  const makeEvent=(tx,status='APPROVED',id=randomUUID(),sck=handoff)=>({id,version:'2.0.0',creation_date:Date.now(),event:'PURCHASE_'+status,data:{product:{id:123,name:'Synthetic course'},buyer:{email:'  SYNTHETIC@example.test  ',checkout_phone:'+5511999990000'},purchase:{transaction:tx,status,approved_date:Date.now(),full_price:{value:197.5,currency_value:'BRL'},origin:{sck},checkout_country:{iso:'BR'}}}});
  const post=async(event,hottok=hottokA)=>webhook(new Request('https://webhook.example.test/',{method:'POST',headers:{'content-type':'application/json','x-hotmart-hottok':hottok},body:JSON.stringify(event)}));
  await t.test('authenticated approved webhook repeated 3x: one sale, one outbox, matching hashes backend only',async()=>{
   const event=makeEvent('SYNTHETIC_TX');
   for(let i=0;i<3;i++){const res=await post(event);assert.equal(res.status,200);assert.equal((await res.json()).duplicate,i>0);}
   const rows=await db.query('select * from private.conversion_event_outbox');assert.equal(rows.rows.length,1);
   assert.equal(rows.rows[0].email_sha256,await sha256('synthetic@example.test'));
   assert.equal(rows.rows[0].phone_sha256,await sha256('5511999990000'));
   assert.equal(rows.rows[0].client_ip,null);
   assert.equal(rows.rows[0].test_mode,true);
   assert.equal((await db.query('select raw,src,sck,xcod from public.sales')).rows[0].sck,null);
  });
  await t.test('same signed sck from another workspace never attributes or queues to wrong dataset',async()=>{
   const res=await post(makeEvent('SYNTHETIC_TX'),hottokB);assert.equal(res.status,200);
   assert.equal((await db.query('select count(*)::int n from public.sales')).rows[0].n,2);
   assert.equal((await db.query('select tracking_session_id from public.attributions where workspace_id=$1',[ids.wb])).rows[0].tracking_session_id,null);
   assert.equal((await db.query('select count(*)::int n from private.conversion_event_outbox where workspace_id=$1',[ids.wb])).rows[0].n,0);
  });
  await t.test('Meta transient response retries with stable event_id; explicit acceptance required',async()=>{
   const bodies=[];let call=0;
   const invoke=()=>handleMetaWorker(new Request('https://worker.example.test/',{method:'POST',headers:{'x-pulso-worker-secret':workerSecret}}),{rpc:serviceRpc,workerSecret,credentialKey,version:'v25.0',fetchImpl:async(url,init)=>{bodies.push(JSON.parse(init.body));assert.ok(url.includes(dataset));assert.ok(init.headers.Authorization);call++;return call===1?Response.json({error:{code:2,is_transient:true}},{status:503}):Response.json({events_received:1,fbtrace_id:'synthetic_trace'});}});
   const first=await invoke();assert.equal(first.status,200);assert.equal((await first.json()).accepted,0);
   assert.equal((await db.query('select status from private.conversion_event_outbox')).rows[0].status,'pending');
   await db.query("update private.conversion_event_outbox set next_attempt_at=now()-interval '1 second'");
   const second=await invoke();assert.equal((await second.json()).accepted,1);
   assert.equal(bodies[0].data[0].event_id,bodies[1].data[0].event_id);assert.equal(bodies[0].data[0].event_name,'Purchase');
   assert.equal(bodies[1].test_event_code,'TEST_SYNTHETIC');
   assert.equal(bodies[1].data[0].custom_data.currency,'BRL');assert.equal(bodies[1].data[0].custom_data.value,197.5);
   assert.equal((await db.query('select status from private.conversion_event_outbox')).rows[0].status,'delivered');
   const third=await invoke();assert.equal((await third.json()).claimed,0);assert.equal(call,2);
  });
  await t.test('dashboard reads safe real aggregates and separates currencies/workspaces',async()=>{
   const report=(await asUser(db,ids.a,"select public.pulso_dashboard_metrics($1,now()-interval '1 day') as m",[ids.wa])).rows[0].m;
   assert.equal(report.currency_summary[0].approved_orders,1);assert.equal(Number(report.currency_summary[0].approved_revenue),197.5);assert.equal(report.funnel.visits,1);assert.equal(report.funnel.checkout_started,1);
   assert.equal(report.capi[0].status,'delivered');assert.equal(report.capi[0].test_mode,true);
   const safe=JSON.stringify(report);for(const sensitive of ['synthetic@example.test',handoff,'client_ip','email_sha256','access_token'])assert.ok(!safe.includes(sensitive));
  });
  await t.test('refund arriving before an older approval never creates a new Purchase',async()=>{
   assert.equal((await post(makeEvent('SYNTHETIC_TX','REFUNDED'))).status,200);
   const old=makeEvent('SYNTHETIC_TX');old.creation_date-=60000;
   assert.equal((await post(old)).status,200);
   assert.equal((await db.query('select status from public.sales where workspace_id=$1',[ids.wa])).rows[0].status,'REFUNDED');
   assert.equal((await db.query('select count(*)::int n from private.conversion_event_outbox')).rows[0].n,1);
  });
  await t.test('revoked consent blocks subsequent resume and clears queued matching identifiers',async()=>{
   assert.equal((await post(makeEvent('SECOND_SYNTHETIC_TX'))).status,200);
   const request=new Request('https://collector.example.test/',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({site_key:siteKey,action:'revoke',resume_token:handoff})});
   assert.equal((await collector(request)).status,200);
   assert.equal((await capture('page_view',handoff)).status,403);
   const rows=(await db.query("select status,email_sha256,fbp from private.conversion_event_outbox where status<>'delivered'")).rows;
   assert.ok(rows.length>0);rows.forEach(row=>{assert.equal(row.status,'failed');assert.equal(row.email_sha256,null);assert.equal(row.fbp,null);});
   const claim=await serviceRpc('pulso_meta_claim',{p_limit:10});assert.equal(claim.length,0);
  });
 }finally{await fixture.close();}
});
