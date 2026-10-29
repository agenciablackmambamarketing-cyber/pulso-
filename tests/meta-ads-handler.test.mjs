import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMetaAds} from '../supabase/functions/_shared/meta-ads.mjs';
import {MetaAdsAPIError} from '../supabase/functions/_shared/meta-ads-api.mjs';
import {sealCredential,openCredential} from '../supabase/functions/_shared/meta.mjs';

const origin='https://dashboard.example.invalid';
const workspace='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const connection='33333333-3333-4333-8333-333333333333';
const leaseId='44444444-4444-4444-8444-444444444444';
const other='55555555-5555-4555-8555-555555555555';
const accountId='123456789';
const token='SYNTHETIC_ADS_TOKEN_NEVER_SEND_TO_REAL_META';
const key=Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const now=Date.parse('2026-10-29T00:30:00Z');
const snapshot={account:{id:accountId,name:'Synthetic ad account',currency:'BRL',timezone_name:'America/Sao_Paulo',account_status:1},campaigns:[],daily:[],account_daily:[]};
const save=(patch={})=>({action:'save',workspace_id:workspace,account_id:'act_'+accountId,access_token:token,...patch});
const sync=(patch={})=>({action:'sync',workspace_id:workspace,connection_id:connection,since:'2026-10-21',until:'2026-10-28',...patch});
const revoke=(patch={})=>({action:'revoke',workspace_id:workspace,connection_id:connection,...patch});
function request(body=save(),headers={},method='POST'){
 return new Request('https://supabase.example.invalid/functions/v1/meta-ads',{
  method,headers:{origin,authorization:'Bearer synthetic_user_session','content-type':'application/json',...headers},
  ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),
 });
}
async function fixture(overrides={}){
 const calls=[],reads=[],auth=[],trace=[];
 const sealed=await sealCredential({dataset_id:'meta_ads:'+accountId,access_token:token},workspace,'meta_ads:'+accountId,key);
 const deps={origins:[origin],credentialKey:key,version:'v26.0',now:()=>now,
  authUser:async value=>{auth.push(value);return {id:user};},
  rpc:async(name,args)=>{
   calls.push({name,args});trace.push(name);
   if(name==='pulso_meta_authorize')return true;
   if(name==='pulso_ads_save')return connection;
   if(name==='pulso_ads_begin_sync')return {connection_id:connection,external_account_id:accountId,sealed_credential:sealed,lease_id:leaseId};
   if(name==='pulso_ads_complete_sync')return {ok:true};
   return undefined;
  },
  read:async(input,config)=>{reads.push({input,config});trace.push('graph_read');return structuredClone(snapshot);},
  ...overrides,
 };
 return {deps,calls,reads,auth,trace,sealed,run:req=>handleMetaAds(req,deps)};
}

test('ads handler rejects foreign origins, unsupported methods and missing user authentication before all reads',async()=>{
 const f=await fixture();
 for(const value of ['', 'null',origin+'.evil.invalid',origin+'/path']){
  const response=await f.run(request(save(),{origin:value}));
  assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
 }
 assert.equal((await f.run(request(undefined,{},'OPTIONS'))).status,204);
 assert.equal((await f.run(request(undefined,{},'GET'))).status,405);
 for(const authorization of ['', 'Basic synthetic','Bearer one two'])assert.equal((await f.run(request('bad JSON',{authorization}))).status,401);
 assert.equal(f.auth.length,0);assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
 for(const authUser of [async()=>null,async()=>({id:'forged'}),async()=>({id:[user]}),async()=>{throw Error(token);}]){
  const invalid=await fixture({authUser});const response=await invalid.run(request());
  assert.equal(response.status,401);assert.ok(!(await response.text()).includes(token));
  assert.equal(invalid.calls.length,0);assert.equal(invalid.reads.length,0);
 }
});

test('verified user still needs actual owner/admin authorization before Graph, saved credentials or revocation',async()=>{
 for(const action of [save(),sync(),revoke()]){
  const calls=[];const f=await fixture({rpc:async(name,args)=>{calls.push({name,args});throw Error('Forbidden '+token);}});
  const response=await f.run(request(action));
  assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'forbidden'});
  assert.deepEqual(calls,[{name:'pulso_meta_authorize',args:{p_workspace_id:workspace,p_user_id:user}}]);
  assert.equal(f.reads.length,0);
 }
 for(const allowed of [false,null,undefined,'true',1]){
  const f=await fixture({rpc:async()=>allowed});
  const response=await f.run(request());
  assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'forbidden'});
  assert.equal(f.reads.length,0);
 }
});

test('strict per-action schema and actual UTF8 body limit prevent actor spoofing and oversized requests',async()=>{
 const f=await fixture();
 for(const input of [save({p_user_id:other}),save({workspace_id:'bad'}),save({workspace_id:[workspace]}),sync({connection_id:[connection]}),sync({connection_id:other,access_token:token}),revoke({since:'2026-10-20'}),save({action:'reprocess'}),null,[],true]){
  const response=await f.run(request(input));assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'invalid_input'});
 }
 for(const raw of ['bad JSON','{"action":"save"'])assert.equal((await f.run(request(raw))).status,400);
 assert.equal((await f.run(request(save(),{'content-type':'text/plain'}))).status,400);
 const body=JSON.stringify(save({extra:'ã'.repeat(8500)}));
 assert.ok(Buffer.byteLength(body)>16384);
 for(const headers of [{},{'content-length':'1'}])assert.equal((await f.run(request(body,headers))).status,413);
 assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
});

test('invalid UTF8 and interrupted input streams fail before authorization or provider reads',async()=>{
 for(const body of [new Uint8Array([0xff]),new ReadableStream({start(controller){controller.error(Error('private input '+token));}})]){
  const f=await fixture();
  const req=new Request('https://supabase.example.invalid/functions/v1/meta-ads',{
   method:'POST',headers:{origin,authorization:'Bearer synthetic_user_session','content-type':'application/json'},body,duplex:'half',
  });
  const result=await f.run(req);
  assert.equal(result.status,400);assert.deepEqual(await result.json(),{error:'invalid_input'});
  assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);
 }
});

test('save verifies ad-read permission for yesterday before persisting only workspace/account-bound ciphertext',async()=>{
 const f=await fixture();const response=await f.run(request());
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,connection_id:connection,status:'connected',synced:false});
 assert.deepEqual(f.trace,['pulso_meta_authorize','graph_read','pulso_ads_save']);
 assert.deepEqual(f.reads[0],{input:{accountId,accessToken:token,since:'2026-10-28',until:'2026-10-28'},config:{version:'v26.0',now}});
 const stored=f.calls.at(-1).args;
 assert.equal(stored.p_workspace_id,workspace);assert.equal(stored.p_user_id,user);
 assert.deepEqual(stored.p_account,snapshot.account);
 assert.ok(!JSON.stringify(f.calls).includes(token));
 assert.equal((await openCredential(stored.p_sealed_credential,workspace,'meta_ads:'+accountId,key)).access_token,token);
 await assert.rejects(openCredential(stored.p_sealed_credential,other,'meta_ads:'+accountId,key));
 await assert.rejects(openCredential(stored.p_sealed_credential,workspace,accountId,key));
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('access-control-allow-origin'),origin);
});

test('invalid ad accounts and tokens fail safely without contacting Graph or storing credentials',async()=>{
 for(const patch of [{account_id:'https://graph.facebook.com/123'},{account_id:'0'},{access_token:'short'},{access_token:token+'\n'}]){
  const f=await fixture();const response=await f.run(request(save(patch)));
  assert.equal(response.status,400);assert.ok(!(await response.text()).includes(token));
  assert.equal(f.reads.length,0);assert.deepEqual(f.calls.map(call=>call.name),['pulso_meta_authorize']);
 }
 const f=await fixture({credentialKey:undefined});assert.equal((await f.run(request())).status,503);assert.equal(f.calls.length,0);
});

test('sync reads a bound leased credential and commits only a full normalized snapshot',async()=>{
 const f=await fixture();const response=await f.run(request(sync()));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,status:'connected',synced:true});
 assert.deepEqual(f.trace,['pulso_meta_authorize','pulso_ads_begin_sync','graph_read','pulso_ads_complete_sync']);
 assert.deepEqual(f.calls[1].args,{p_workspace_id:workspace,p_user_id:user,p_connection_id:connection});
 assert.deepEqual(f.reads[0].input,{accountId,accessToken:token,since:'2026-10-21',until:'2026-10-28'});
 assert.deepEqual(f.calls[2].args,{p_workspace_id:workspace,p_connection_id:connection,p_lease_id:leaseId,p_since:'2026-10-21',p_until:'2026-10-28',p_snapshot:snapshot});
 assert.ok(!JSON.stringify(f.calls).includes(token));
});

test('provider failures mark only the bound lease with a static error and never commit partial data',async()=>{
 for(const [code,retryable,status] of [['meta_ads_auth',false,422],['meta_ads_permission',false,422],['meta_ads_network',true,503],['meta_ads_pagination_limit',false,422]]){
  const error=new MetaAdsAPIError(code,{retryable});error.message=token;
  const f=await fixture({read:async()=>{throw error;}});const response=await f.run(request(sync()));
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:code});
  assert.deepEqual(f.calls.map(call=>call.name),['pulso_meta_authorize','pulso_ads_begin_sync','pulso_ads_fail_sync']);
  assert.deepEqual(f.calls.at(-1).args,{p_workspace_id:workspace,p_connection_id:connection,p_lease_id:leaseId,p_error_code:code});
  assert.ok(!JSON.stringify(f.calls).includes(token));
 }
 const f=await fixture({read:async()=>{throw Error('Provider details '+token);}});
 const response=await f.run(request(sync()));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'meta_ads_sync_failed'});
});

test('invalid dates are denied before credential reads, while wrong-account leases or sealed credentials cannot reach Graph',async()=>{
 for(const patch of [{since:'2026-09-01'},{until:'2026-12-01'},{since:'not a date'},{since:'2026-10-29',until:'2026-10-20'}]){
  const f=await fixture();const response=await f.run(request(sync(patch)));
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'invalid_date_window'});
  assert.deepEqual(f.calls.map(call=>call.name),['pulso_meta_authorize']);assert.equal(f.reads.length,0);
 }
 const base=await fixture();
 for(const lease of [null,{connection_id:other,lease_id:leaseId},{connection_id:connection,lease_id:'bad'},
  {connection_id:connection,lease_id:leaseId,external_account_id:accountId,sealed_credential:await sealCredential({dataset_id:'meta_ads:'+accountId,access_token:token},other,'meta_ads:'+accountId,key)},
  {connection_id:connection,lease_id:leaseId,external_account_id:'999999999',sealed_credential:base.sealed}]){
  const calls=[];const f=await fixture({rpc:async(name,args)=>{calls.push({name,args});if(name==='pulso_meta_authorize')return true;if(name==='pulso_ads_begin_sync')return lease;}});
  const response=await f.run(request(sync()));assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'meta_ads_sync_failed'});assert.equal(f.reads.length,0);
  assert.ok(!calls.some(call=>call.name==='pulso_ads_complete_sync'));
 }
});

test('completion and stale-lease errors remain redacted and cannot be presented as a successful sync',async()=>{
 const base=await fixture();const calls=[];
 const f=await fixture({rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='pulso_meta_authorize')return true;
  if(name==='pulso_ads_begin_sync')return {connection_id:connection,external_account_id:accountId,sealed_credential:base.sealed,lease_id:leaseId};
  if(name==='pulso_ads_complete_sync'||name==='pulso_ads_fail_sync')throw Error('Stale lease '+token);
 }});
 const response=await f.run(request(sync()));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'meta_ads_sync_failed'});
 assert.deepEqual(calls.map(call=>call.name),['pulso_meta_authorize','pulso_ads_begin_sync','pulso_ads_complete_sync','pulso_ads_fail_sync']);
 const invalid=await fixture({rpc:async name=>name==='pulso_meta_authorize'?true:name==='pulso_ads_save'?{unexpected:token}:undefined});
 const saved=await invalid.run(request(save()));assert.equal(saved.status,503);assert.deepEqual(await saved.json(),{error:'meta_ads_sync_failed'});
});

test('revoke passes only the verified actor and requested workspace/connection and performs no Graph read',async()=>{
 const f=await fixture();const response=await f.run(request(revoke()));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,status:'revoked'});
 assert.deepEqual(f.calls,[{name:'pulso_meta_authorize',args:{p_workspace_id:workspace,p_user_id:user}},
  {name:'pulso_ads_revoke',args:{p_workspace_id:workspace,p_user_id:user,p_connection_id:connection}}]);
 assert.equal(f.reads.length,0);
 const forbidden=await fixture({rpc:async name=>{if(name==='pulso_meta_authorize')return true;if(name==='pulso_ads_revoke')throw Error(token);}});
 const failed=await forbidden.run(request(revoke()));assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'meta_ads_sync_failed'});
});
