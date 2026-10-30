import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeConfig,runtimeSettingNames,supabaseRuntimeKey,collectorDatabaseError,hotmartDatabaseError} from '../supabase/functions/_shared/runtime-config.mjs';
const key='synthetic-only-fixture-value-over-32-chars';
const collector={PULSO_HANDOFF_HMAC_KEY:key,PULSO_RATE_HASH_KEY:key+'different'};
const load=(component,env={},value=collector)=>loadRuntimeConfig(component,{getEnv:name=>env[name],rpc:async(name,args)=>{assert.equal(name,'pulso_runtime_config');assert.equal(args.p_component,component);return value;}});
test('complete env configuration takes precedence without Vault lookup',async()=>{
 const got=await loadRuntimeConfig('collector',{getEnv:n=>collector[n],rpc:async()=>assert.fail('must not read Vault')});
 assert.deepEqual(got,collector);assert.equal(Object.isFrozen(got),true);
});
test('only absent env allows complete component-scoped Vault configuration',async()=>assert.deepEqual(await load('collector'),collector));
test('partial or empty env fails closed without mixing stores',async()=>{
 for(const env of [{PULSO_HANDOFF_HMAC_KEY:key},{PULSO_HANDOFF_HMAC_KEY:''},{PULSO_HANDOFF_HMAC_KEY:'',PULSO_RATE_HASH_KEY:key}]){
  await assert.rejects(loadRuntimeConfig('collector',{getEnv:n=>env[n],rpc:async()=>assert.fail('partial env must not fallback')}),/runtime_configuration_unavailable/);
 }
});
test('missing, malformed or extra Vault keys never leak responses or values',async()=>{
 for(const value of [null,[],{},'secret-response',{PULSO_HANDOFF_HMAC_KEY:key},{...collector,EXTRA_SECRET:key},{...collector,PULSO_HANDOFF_HMAC_KEY:'short'}])await assert.rejects(load('collector',{},value),{message:'runtime_configuration_unavailable'});
 await assert.rejects(loadRuntimeConfig('collector',{getEnv:()=>undefined,rpc:async()=>{throw new Error('internal secret material');}}),{message:'runtime_configuration_unavailable'});
});
test('component names and key names cannot be chosen by untrusted input',async()=>{
 for(const value of ['constructor','toString','unknown','PULSO_META_CREDENTIAL_KEY_V1'])assert.throws(()=>runtimeSettingNames(value),/runtime_configuration_unavailable/);
 assert.deepEqual(runtimeSettingNames('webhook'),['PULSO_HANDOFF_HMAC_KEY']);
});
test('origins and Meta settings require secure complete values',async()=>{
 await assert.rejects(load('hotmart_connect',{}, {PULSO_DASHBOARD_ORIGINS:'*'}));
 await assert.rejects(load('hotmart_connect',{}, {PULSO_DASHBOARD_ORIGINS:'http://example.test'}));
 await assert.rejects(load('hotmart_connect',{}, {PULSO_DASHBOARD_ORIGINS:'https://example.test/path'}));
 const settings={PULSO_ADMIN_ORIGINS:'https://stage.example.test',PULSO_META_CREDENTIAL_KEY_V1:Buffer.alloc(32,23).toString('base64'),META_GRAPH_VERSION:'v25.0'};
 assert.deepEqual(await load('meta_connect',{},settings),settings);
 for(const patch of [{META_GRAPH_VERSION:'latest'},{PULSO_META_CREDENTIAL_KEY_V1:'short'}])await assert.rejects(load('meta_connect',{}, {...settings,...patch}));
});
test('built-in Supabase key parsing denies invalid modern key maps without fallback',()=>{
 const legacy={SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-key'};
 assert.equal(supabaseRuntimeKey(n=>legacy[n],'secret'),'synthetic-server-key');
 assert.throws(()=>supabaseRuntimeKey(n=>({...legacy,SUPABASE_SECRET_KEYS:'invalid'})[n],'secret'),{message:'runtime_configuration_unavailable'});
 assert.throws(()=>supabaseRuntimeKey(n=>legacy[n],'untrusted'),{message:'runtime_configuration_unavailable'});
});

test('collector DB boundary preserves only exact protocol errors and redacts arbitrary metadata',async()=>{
 const {createCollector}=await import('../supabase/functions/_shared/collector.mjs');
 const origin='https://stage.example.test',site='fixture_stage_site';
 for(const [message,status,publicError] of [
  ['rate_limit',429,'rate_limit'],['invalid_resume',403,'invalid_resume'],['consent_required',403,'consent_required'],['origin_denied',403,'origin_denied'],
  ['rate_limit internal-secret',503,'collector_unavailable'],['invalid_resume: buyer@example.test',503,'collector_unavailable'],['private.customer_constraint failed',503,'collector_unavailable'],
 ]){
  const handler=createCollector({handoffKey:key,rpc:async name=>{
   if(name==='pulso_site_config')return {active:true,allowed_origins:[origin],consent_policy_version:'v1'};
   throw collectorDatabaseError({message,details:'must never reach response',hint:'private info'});
  }});
  const response=await handler(new Request('https://api.example.test/',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({site_key:site,event_id:crypto.randomUUID(),event_name:'page_view',page_url:origin+'/',click:{},browser:{fbp:null,fbc:null},consent:{marketing:true,basis:'consent',policy_version:'v1',captured_at:new Date().toISOString()}})}));
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:publicError});
 }
 for(const input of [null,{}, {message:'RATE_LIMIT'},{message:'rate_limit\nsecret'}])assert.equal(collectorDatabaseError(input).message,'database_operation');
});

test('webhook DB boundary keeps only exact authorization/validation labels and hides all other database data',async()=>{
 const {createHotmartHandler}=await import('../supabase/functions/_shared/hotmart.mjs');
 for(const [message,status,publicError] of [
  ['Unauthorized Hotmart source',401,'Unauthorized'],
  ...['Invalid Hotmart event','Invalid event timestamp','Invalid event status','Invalid money amount','Invalid product','Transaction facts changed'].map(message=>[message,400,'Invalid event']),
  ['Unauthorized Hotmart source buyer@example.test',503,'Ingestion failed'],['Invalid product internal-secret',503,'Ingestion failed'],['constraint private_customer_key failed',503,'Ingestion failed'],
 ]){
  const handler=createHotmartHandler({rpc:async()=>({data:null,error:hotmartDatabaseError({message,details:'private',hint:'secret'})}),verifyHandoff:async()=>false,sha256:async()=>''});
  const response=await handler(new Request('https://webhook.example.test/',{method:'POST',headers:{'content-type':'application/json','x-hotmart-hottok':'synthetic-hottok-never-real'},body:JSON.stringify({id:'synthetic-event',version:'2.0.0',creation_date:Date.now(),event:'PURCHASE_APPROVED',data:{product:{id:123,name:'Synthetic offer'},purchase:{transaction:'SYNTHETIC_TX',status:'APPROVED',full_price:{value:100,currency_value:'BRL'}}}})}));
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:publicError});
 }
 for(const input of [null,{}, {message:'UNAUTHORIZED'},{message:'Invalid event status\nprivate'}])assert.equal(hotmartDatabaseError(input).message,'database_operation');
});
