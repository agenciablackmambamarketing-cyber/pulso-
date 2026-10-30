import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validatePublicConfig,startConfiguredDashboard} from '../dashboard/config.mjs';
import {buildStagingDashboard} from '../scripts/build-staging-dashboard.mjs';
const ref='osgumasejgumqlnqxcvm';
const valid=()=>({environment:'staging',project_ref:ref,supabase_url:`https://${ref}.supabase.co`,publishable_key:'sb_publishable_'+ 'synthetic'.repeat(4)});
const jwt=(role,project=ref)=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({role,ref:project})).toString('base64url'),'syntheticSignature'].join('.');
test('only explicit public config for matching project can initialize a dashboard',async()=>{
 let init=0,queries=0;const fetchImpl=async(url,options)=>{queries++;assert.equal(url,'./config.json');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');return Response.json(valid());};
 assert.equal(await startConfiguredDashboard({fetchImpl,onReady:config=>{init++;assert.equal(config.project_ref,ref);},onError:()=>assert.fail('valid config failed')}),true);
 assert.equal(init,1);assert.equal(queries,1);
});
test('missing config and failed response never initialize auth or Supabase client',async()=>{
 for(const fetchImpl of [async()=>new Response('',{status:404}),async()=>{throw Error('offline');},async()=>Response.json({})]){
  let initialized=false,message;
  assert.equal(await startConfiguredDashboard({fetchImpl,onReady:()=>{initialized=true;},onError:value=>{message=value;}}),false);
  assert.equal(initialized,false);assert.match(message,/Não foi possível carregar a configuração/);
 }
});
test('staging rejects production ref, URL spoofing, secret keys, JWT service role and unexpected fields',()=>{
 for(const invalid of [
  {...valid(),project_ref:'nlrhtioxsbncpluchfcz',supabase_url:'https://nlrhtioxsbncpluchfcz.supabase.co'},
  {...valid(),supabase_url:'https://other.example.test'},
  {...valid(),supabase_url:valid().supabase_url+'/'},
  {...valid(),supabase_url:'http://'+ref+'.supabase.co'},
  {...valid(),publishable_key:'sb_secret_'+ 'synthetic'.repeat(4)},
  {...valid(),publishable_key:jwt('service_role')},
  {...valid(),publishable_key:jwt('anon','aaaaaaaaaaaaaaaaaaaa')},
  {...valid(),access_token:'should-never-be-here'},
  {...valid(),environment:'preview'},
 ])assert.throws(()=>validatePublicConfig(invalid),/Configuração/);
 assert.equal(validatePublicConfig({...valid(),publishable_key:jwt('anon')}).publishable_key,jwt('anon'));
});
test('staging build generates isolated config and copies no production configuration',async()=>{
 const output=await mkdtemp(join(tmpdir(),'pulso-dashboard-test-'));
 try{
  await buildStagingDashboard({PULSO_STAGING_PROJECT_REF:ref,PULSO_STAGING_PUBLISHABLE_KEY:valid().publishable_key},output);
  const config=JSON.parse(await readFile(join(output,'config.json'),'utf8'));
  assert.deepEqual(config,valid());
  const app=await readFile(join(output,'app.mjs'),'utf8');
  assert.ok(!app.includes('nlrhtioxsbncpluchfcz.supabase.co'));
  assert.ok(!app.includes('sb_publishable_'));
  assert.match(app,/startConfiguredDashboard/);
  await assert.rejects(buildStagingDashboard({PULSO_STAGING_PROJECT_REF:'nlrhtioxsbncpluchfcz',PULSO_STAGING_PUBLISHABLE_KEY:valid().publishable_key},output),/Configuração/);
 }finally{await rm(output,{recursive:true,force:true});}
});


test('private dashboard configuration keeps its same-origin session before initialization',async()=>{
 let initialized=0;
 const privateSite=async(_url,options)=>{
  // A private host requires its own session; dropping credentials redirects to login.
  if(options.credentials!=='same-origin')throw new TypeError('redirect blocked by private host');
  return Response.json(valid());
 };
 assert.equal(await startConfiguredDashboard({fetchImpl:privateSite,onReady:()=>{initialized++;},onError:()=>assert.fail('private session was dropped')}),true);
 assert.equal(initialized,1);
});

test('startup failures are distinguished from missing configuration without leaking details',async()=>{
 let message;
 const result=await startConfiguredDashboard({fetchImpl:async()=>Response.json(valid()),onReady:()=>{throw new Error('private internal initialization details');},onError:value=>{message=value;}});
 assert.equal(result,false);
 assert.match(message,/configuração foi carregada/);
 assert.ok(!message.includes('private internal'));
 assert.ok(!message.includes('não iniciou conexão'));
});
