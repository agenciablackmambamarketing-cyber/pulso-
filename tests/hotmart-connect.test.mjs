import test from 'node:test';
import assert from 'node:assert/strict';
import {createHotmartConnectHandler,hotmartConnectConfig} from '../supabase/functions/_shared/hotmart-connect.mjs';
const origin='https://pulso.example.invalid';
const workspace='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const source='33333333-3333-4333-8333-333333333333';
const hottok='synthetic_hottok_value';
function setup(overrides={}){
 const calls=[];const authTokens=[];
 const handler=createHotmartConnectHandler({origins:[origin],webhookUrl:'https://project.example.invalid/functions/v1/hotmart-webhook',authUser:async token=>{authTokens.push(token);return {id:user};},rpc:async(name,args)=>{calls.push({name,args});return {data:source,error:null};},...overrides});
 return {handler,calls,authTokens};
}
function req(input={workspace_id:workspace,hottok},headers={},method='POST'){
 return new Request('https://project.example.invalid/functions/v1/hotmart-connect',{method,headers:{origin,'content-type':'application/json',authorization:'Bearer synthetic_jwt',...headers},...(method==='POST'?{body:typeof input==='string'?input:JSON.stringify(input)}:{})});
}
test('Hotmart connect requires bearer auth before RPC or body processing',async()=>{
 const s=setup();const response=await s.handler(req('not JSON',{authorization:''}));
 assert.equal(response.status,401);assert.equal(s.calls.length,0);assert.equal(s.authTokens.length,0);
 for(const authorization of ['Basic synthetic','Bearer one two','synthetic_jwt'])assert.equal((await s.handler(req(undefined,{authorization}))).status,401);
});
test('invalid/revoked Supabase user sessions never reach privileged RPC',async()=>{
 for(const authUser of [async()=>null,async()=>{throw new Error('bad token synthetic_jwt');},async()=>({id:'fake'})]){
  const s=setup({authUser});assert.equal((await s.handler(req())).status,401);assert.equal(s.calls.length,0);
 }
});
test('registration binds trusted verified user and exact workspace with write-only Hottok',async()=>{
 const s=setup();const response=await s.handler(req({workspace_id:workspace,hottok,label:'  Agência  '}));
 assert.equal(response.status,200);assert.deepEqual(s.authTokens,['synthetic_jwt']);
 assert.deepEqual(s.calls,[{name:'register_hotmart_source',args:{p_workspace_id:workspace,p_user_id:user,p_label:'Agência',p_hottok:hottok}}]);
 assert.deepEqual(await response.json(),{ok:true,source_id:source,webhook_url:'https://project.example.invalid/functions/v1/hotmart-webhook'});
 assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('viewer and cross-tenant credential refusals return safe forbidden without secret echo',async()=>{
 for(const message of ['Workspace access denied','Credential is assigned to another workspace']){
  const s=setup({rpc:async()=>({data:null,error:{message:message+' '+hottok}})});
  const response=await s.handler(req());assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'forbidden'});
 }
});
test('browser origin exact allowlist is required, including preflight',async()=>{
 const s=setup();for(const value of ['', 'null','https://evil.example.invalid',origin+'.evil.invalid',origin+'/path']){
  const response=await s.handler(req(undefined,{origin:value}));assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
 }
 assert.equal(s.calls.length,0);assert.equal(s.authTokens.length,0);
 const preflight=await s.handler(req(undefined,{},'OPTIONS'));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const closed=setup({origins:[]});assert.equal((await closed.handler(req())).status,403);
});
test('strict workspace, label, Hottok and unknown-field validation before RPC',async()=>{
 const s=setup();for(const patch of [{workspace_id:'other'},{workspace_id:123},{hottok:'short'},{hottok:'a'.repeat(513)},{hottok:'x'.repeat(12)+'\n'},{label:3},{label:''},{label:'a'.repeat(101)},{label:'bad\nlabel'},{p_user_id:user},{workspace_id:workspace,pixel_id:'123'},{role:'owner'}]){
  const response=await s.handler(req({workspace_id:workspace,hottok,...patch}));assert.equal(response.status,400,JSON.stringify(patch));assert.equal((await response.text()).includes(hottok),false);
 }
 assert.equal(s.calls.length,0);
 for(const invalid of ['null','[]','true','{bad'])assert.equal((await s.handler(req(invalid))).status,400);
});
test('actual UTF-8 body bytes bounded at 16KiB with absent or dishonest Content-Length',async()=>{
 const s=setup();const body=JSON.stringify({workspace_id:workspace,hottok,extra:'ã'.repeat(8500)});
 assert.ok(body.length<16_384);assert.ok(Buffer.byteLength(body)>16_384);
 for(const headers of [{},{'content-length':'1'}])assert.equal((await s.handler(req(body,headers))).status,413);
 assert.equal(s.calls.length,0);
 assert.equal((await s.handler(req(undefined,{'content-length':'17000'}))).status,413);
 assert.equal((await s.handler(req(undefined,{'content-type':'text/plain'}))).status,415);
});
test('unexpected database errors and thrown exceptions are redacted and retriable',async()=>{
 for(const rpc of [async()=>({error:{message:hottok,code:'XX000'},data:null}),async()=>{throw new Error(hottok);},async()=>({data:{hottok},error:null})]){
  const s=setup({rpc});const response=await s.handler(req());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'registration_unavailable'});
 }
});
test('safe server configuration parsing rejects malformed key maps and invalid origins',()=>{
 const env={SUPABASE_URL:'https://project.example.invalid',SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'synthetic_public'}),SUPABASE_SECRET_KEYS:JSON.stringify({default:'synthetic_server'}),PULSO_DASHBOARD_ORIGINS:origin};
 assert.deepEqual(hotmartConnectConfig(k=>env[k]),{url:'https://project.example.invalid',publishableKey:'synthetic_public',secretKey:'synthetic_server',origins:[origin]});
 for(const patch of [{SUPABASE_SECRET_KEYS:'{'},{SUPABASE_SECRET_KEYS:'null'},{SUPABASE_SECRET_KEYS:'[]'},{SUPABASE_SECRET_KEYS:'{"default":123}'},{PULSO_DASHBOARD_ORIGINS:''},{PULSO_DASHBOARD_ORIGINS:'*'},{PULSO_DASHBOARD_ORIGINS:origin+'/page'},{SUPABASE_URL:'https://user:password@project.example.invalid'}])assert.equal(hotmartConnectConfig(k=>({...env,...patch})[k]),null);
 const legacy={SUPABASE_URL:env.SUPABASE_URL,SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server',PULSO_DASHBOARD_ORIGINS:origin};assert.equal(hotmartConnectConfig(k=>legacy[k]).secretKey,'server');
});
test('unsupported methods and missing server dependencies fail closed',async()=>{
 assert.equal((await setup().handler(req(undefined,{},'GET'))).status,405);
 assert.equal((await setup({configured:false}).handler(req())).status,503);
});
