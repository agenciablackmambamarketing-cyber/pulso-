import test from 'node:test';
import assert from 'node:assert/strict';
import {purchasePayload,sendPurchase,verifyDataset,safeResult,sealCredential,openCredential,secretMatches,conversionProvider} from '../supabase/functions/_shared/meta.mjs';
import {handleMetaConnect} from '../supabase/functions/_shared/meta-connect.mjs';
import {handleMetaWorker} from '../supabase/functions/_shared/meta-worker.mjs';
const workspace='c410789a-d02d-42f0-8028-d84adeab7060';
const other='1b4e29aa-d02d-42f0-8028-d84adeab7060';
const ref='12ed29aa-d02d-42f0-8028-d84adeab7060';
const key=btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
const token='mock-capi-token-for-offline-tests-only';
const now=Date.parse('2026-10-28T01:00:00Z');
const credential={access_token:token,dataset_id:'123456789',mode:'test',test_event_code:'TEST123'};
function event(changes={}){return {workspace_id:workspace,id:ref,provider:'meta',event_name:'Purchase',event_id:'a'.repeat(64),event_time:new Date(now).toISOString(),marketing_allowed:true,test_mode:true,value:'149.90',currency:'USD',email_sha256:'b'.repeat(64),fbp:'fb.1.123.id',client_ip:'192.0.2.1',client_user_agent:'Offline UA',...changes};}
const request=(body,headers={})=>new Request('https://example.test/meta-connect',{method:'POST',headers:{origin:'https://dashboard.example',authorization:'Bearer test-auth','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const ok=body=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});

test('Meta payload uses original currency/value, hashed identifiers and plain fbp/IP/UA',()=>{
 const payload=purchasePayload(event(),credential,{now});
 assert.equal(payload.data[0].custom_data.currency,'USD');assert.equal(payload.data[0].custom_data.value,149.9);
 assert.deepEqual(payload.data[0].user_data.em,['b'.repeat(64)]);assert.equal(payload.data[0].user_data.client_ip_address,'192.0.2.1');
 assert.equal(payload.data[0].user_data.fbp,'fb.1.123.id');assert.equal(payload.test_event_code,'TEST123');
 assert.equal(payload.data[0].event_id,'a'.repeat(64));assert.ok(!JSON.stringify(payload).includes(token));
});
test('Meta dedupe ID survives retries and maps same event name',async()=>{
 const bodies=[];
 for(let i=0;i<2;i++)await sendPurchase(event(),credential,{now,version:'v25.0',fetchImpl:async(url,opts)=>{bodies.push(JSON.parse(opts.body));assert.ok(!url.includes(token));assert.equal(opts.headers.Authorization,`Bearer ${token}`);return ok({events_received:1});}});
 assert.equal(bodies[0].data[0].event_id,bodies[1].data[0].event_id);assert.equal(bodies[0].data[0].event_name,'Purchase');
});
test('Meta missing consent, token, test code, matching, stale events and non-Purchase fail closed',()=>{
 for(const [row,cred,reason] of [[event({marketing_allowed:false}),credential,'event_not_authorized'],[event(),{},'credential_missing'],[event(),{...credential,test_event_code:null},'test_code_required'],[event({event_name:'checkout_click'}),credential,'event_not_authorized'],[event({email_sha256:null,fbp:null,client_ip:null,client_user_agent:null}),credential,'matching_missing'],[event({event_time:'2026-10-01'}),credential,'event_expired']])assert.throws(()=>purchasePayload(row,cred,{now}),new RegExp(reason));
});
test('production mode cannot use test pipeline; future adapters stay unimplemented',()=>{
 assert.throws(()=>purchasePayload(event({test_mode:false}),{...credential,mode:'production'},{now}),/production_disabled/);
 assert.throws(()=>conversionProvider('google_ads'),/provider_not_implemented/);assert.throws(()=>conversionProvider('taboola'),/provider_not_implemented/);
});
test('malformed hashes and source URL credentials rejected',()=>{
 assert.throws(()=>purchasePayload(event({email_sha256:'buyer@example.invalid'}),credential,{now}),/invalid_hash/);
 assert.throws(()=>purchasePayload(event({event_source_url:'https://user:password@example.test/'}),credential,{now}),/invalid_source/);
 const p=purchasePayload(event({event_source_url:'https://sales.example/offer?email=secret#hash'}),credential,{now});assert.equal(p.data[0].event_source_url,'https://sales.example/offer');
});
test('Meta acknowledgement requires HTTP success plus events_received=1; errors are redacted',()=>{
 assert.equal(safeResult(200,{events_received:0}).accepted,false);assert.equal(safeResult(500,{events_received:1}).accepted,false);
 assert.equal(safeResult(200,{events_received:1}).accepted,true);
 const result=safeResult(400,{error:{code:190,message:`sensitive ${token}`,error_data:{email:'pii'}}});
 assert.equal(result.error_code,'meta_auth');assert.equal(result.retryable,false);assert.ok(!JSON.stringify(result).includes(token));
 assert.equal(safeResult(429,{error:{code:4}}).retryable,true);assert.equal(safeResult(400,{error:{code:2,is_transient:true}}).retryable,true);
});
test('transport connection errors are retryable with no leaked request',async()=>{
 const result=await sendPurchase(event(),credential,{now,version:'v25.0',fetchImpl:async()=>{throw new Error(token);}});
 assert.equal(result.retryable,true);assert.equal(result.error_code,'meta_network');assert.ok(!JSON.stringify(result).includes(token));
});
test('dataset validation requires authenticated ID equality, no conversion sent',async()=>{
 const seen=[];const fetchImpl=async(url,opts)=>{seen.push([url,opts]);return ok({id:'123456789'});};
 assert.deepEqual(await verifyDataset('123456789',token,{fetchImpl,version:'v25.0'}),{ok:true});assert.equal(seen[0][1].body,undefined);
 assert.equal((await verifyDataset('123456789',token,{fetchImpl:async()=>ok({id:'999999999'}),version:'v25.0'})).ok,false);
 assert.equal((await verifyDataset('123456789',token,{fetchImpl:async()=>new Response('{}',{status:401}),version:'v25.0'})).ok,false);
});
test('AES-GCM credentials bound to workspace and dataset; no plaintext persisted',async()=>{
 const sealed=await sealCredential(credential,workspace,credential.dataset_id,key);
 assert.ok(!sealed.includes(token));assert.deepEqual(await openCredential(sealed,workspace,credential.dataset_id,key),credential);
 await assert.rejects(openCredential(sealed,other,credential.dataset_id,key));await assert.rejects(openCredential(sealed,workspace,'999999999',key));
 await assert.rejects(openCredential(sealed,workspace,credential.dataset_id,btoa('x'.repeat(32))));
});
test('worker shared secret comparison denies unset, short and incorrect credentials',async()=>{
 assert.equal(await secretMatches(null,null),false);assert.equal(await secretMatches('short','short'),false);
 assert.equal(await secretMatches('x'.repeat(40),'y'.repeat(40)),false);assert.equal(await secretMatches('x'.repeat(40),'x'.repeat(40)),true);
});
test('admin endpoint denies disallowed origins, missing auth and non-admin before Graph requests',async()=>{
 let sent=0;const deps={origins:['https://dashboard.example'],credentialKey:key,version:'v25.0',fetchImpl:async()=>{sent++;return ok({id:'123456789'});},authUser:async()=>({id:ref}),rpc:async()=>{throw new Error('forbidden');}};
 assert.equal((await handleMetaConnect(request({}),deps)).status,400);
 assert.equal((await handleMetaConnect(request({action:'save',workspace_id:workspace}),deps)).status,403);
 assert.equal((await handleMetaConnect(request({},{origin:'https://evil.example'}),deps)).status,403);
 assert.equal((await handleMetaConnect(request({},{authorization:''}),deps)).status,401);assert.equal(sent,0);
});
test('admin save verifies dataset, sends only sealed ciphertext to SQL and never returns token',async()=>{
 let saved;const deps={origins:['https://dashboard.example'],credentialKey:key,version:'v25.0',fetchImpl:async()=>ok({id:'123456789'}),authUser:async()=>({id:ref}),rpc:async(name,args)=>{if(name==='pulso_meta_authorize')return true;if(name==='pulso_meta_save'){saved=args;return ref;}throw new Error('bad rpc');}};
 const response=await handleMetaConnect(request({action:'save',workspace_id:workspace,dataset_id:'123456789',access_token:token,test_event_code:'TEST123'}),deps);
 assert.equal(response.status,200);assert.ok(!saved.p_ciphertext.includes(token));assert.ok(!(await response.text()).includes(token));assert.equal(saved.p_mode,'test');
});
test('wrong/revoked Meta token is rejected before credentials stored',async()=>{
 let writes=0;const deps={origins:['https://dashboard.example'],credentialKey:key,version:'v25.0',fetchImpl:async()=>new Response(JSON.stringify({error:{code:190,message:token}}),{status:400}),authUser:async()=>({id:ref}),rpc:async(name)=>{if(name==='pulso_meta_save')writes++;return true;}};
 const response=await handleMetaConnect(request({action:'save',workspace_id:workspace,dataset_id:'123456789',access_token:token,test_event_code:'TEST123'}),deps);
 assert.equal(response.status,422);assert.equal(writes,0);assert.ok(!(await response.text()).includes(token));
});
test('admin input stream length enforced even without Content-Length',async()=>{
 const deps={origins:['https://dashboard.example'],credentialKey:key,version:'v25.0',authUser:async()=>({id:ref}),rpc:async()=>true};
 const response=await handleMetaConnect(request({oversize:'x'.repeat(17000)}),deps);assert.equal(response.status,413);
});
test('worker auth protects queue and only test rows are processed; lease failure prevents network',async()=>{
 const sealed=await sealCredential(credential,workspace,credential.dataset_id,key);let fetches=0,claims=0;
 const deps={credentialKey:key,workerSecret:'s'.repeat(40),version:'v25.0',fetchImpl:async()=>{fetches++;return ok({events_received:1});},rpc:async(name)=>{if(name==='pulso_meta_claim'){claims++;return [{...event(),event_time:new Date().toISOString(),dataset_id:credential.dataset_id,ciphertext:sealed,lease_token:ref}];}if(name==='pulso_meta_lease_valid')return false;throw new Error('unexpected');}};
 const no=await handleMetaWorker(new Request('https://example.test/worker',{method:'POST'}),deps);assert.equal(no.status,401);assert.equal(claims,0);
 const response=await handleMetaWorker(new Request('https://example.test/worker',{method:'POST',headers:{'x-pulso-worker-secret':'s'.repeat(40)}}),deps);
 assert.equal(response.status,200);assert.equal(fetches,0);assert.equal((await response.json()).skipped,1);
});
test('worker accepts only successful receipt; records safe transient error with stable lease',async()=>{
 const sealed=await sealCredential(credential,workspace,credential.dataset_id,key);const finishes=[];
 const deps={credentialKey:key,workerSecret:'s'.repeat(40),version:'v25.0',fetchImpl:async()=>new Response(JSON.stringify({error:{code:4,message:token}}),{status:429}),rpc:async(name,args)=>{
  if(name==='pulso_meta_claim')return [{...event(),event_time:new Date().toISOString(),dataset_id:credential.dataset_id,ciphertext:sealed,lease_token:ref}];
  if(name==='pulso_meta_lease_valid')return true;if(name==='pulso_meta_finish'){finishes.push(args);return true;}throw new Error('unexpected');
 }};
 const response=await handleMetaWorker(new Request('https://example.test/worker',{method:'POST',headers:{'x-pulso-worker-secret':'s'.repeat(40)}}),deps);
 assert.equal((await response.json()).failed,1);assert.equal(finishes[0].p_retryable,true);assert.equal(finishes[0].p_lease_token,ref);assert.ok(!JSON.stringify(finishes).includes(token));
});
