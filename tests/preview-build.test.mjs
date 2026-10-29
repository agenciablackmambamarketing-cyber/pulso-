import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildStagingDashboard} from '../scripts/build-staging-dashboard.mjs';
import {EMBARQUE_PREVIEW,isEmbarquePreviewLocation} from '../tracker/preview-config.mjs';
import {createPreviewSession,PREVIEW_CONSENT_POLICY} from '../tracker/preview-session.mjs';
import {createPulsoTracker} from '../tracker/pulso-tracker.mjs';

const env=(ref=EMBARQUE_PREVIEW.projectRef)=>({
  PULSO_STAGING_PROJECT_REF:ref,
  PULSO_STAGING_PUBLISHABLE_KEY:'sb_publishable_'+'synthetic'.repeat(4),
});
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match=>[match[1],match[2]]));
async function builtPreview(run){
  const output=await mkdtemp(join(tmpdir(),'pulso-page-preview-'));
  try{
    await buildStagingDashboard(env(),output);
    const preview=join(output,EMBARQUE_PREVIEW.path);
    await run({output,preview,html:await readFile(join(preview,'index.html'),'utf8')});
  }finally{await rm(output,{recursive:true,force:true});}
}

test('preview artifact packages the same eight image assets and all local tracking modules',async()=>{
  await builtPreview(async({preview,html})=>{
    const manifest=JSON.parse(await readFile(join(preview,'snapshot.json'),'utf8'));
    assert.equal(manifest.source_url,'https://ingles-de-embarque-black-mamba.netlify.app/');
    assert.match(manifest.source_sha256,/^[0-9a-f]{64}$/);
    assert.equal(manifest.assets.length,8);
    assert.equal((await readdir(join(preview,'assets'))).length,8);
    for(const asset of manifest.assets){
      const bytes=await readFile(join(preview,asset.path));
      assert.equal(bytes.length,asset.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
      assert.equal(bytes.toString('ascii',0,4),'RIFF');
      assert.equal(bytes.toString('ascii',8,12),'WEBP');
    }
    const local=[...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
      .map(match=>match[1]).filter(value=>!value.includes('://'));
    assert.ok(local.length>8);
    for(const path of local)await stat(join(preview,path.split('?')[0]));
    for(const file of ['preview.mjs','preview.css','pulso-tracker.mjs','preview-session.mjs','preview-config.mjs'])await stat(join(preview,file));
    assert.equal(EMBARQUE_PREVIEW.policyVersion,PREVIEW_CONSENT_POLICY);
  });
});

test('preview removes production advertising and cannot navigate to payment with JavaScript disabled',async()=>{
  await builtPreview(async({html})=>{
    assert.doesNotMatch(html,/\bfbq\b|fbevents|connect\.facebook|facebook\.com\/tr|InitiateCheckout/i);
    assert.doesNotMatch(html,/<(?:iframe|form)\b/i);
    const checkoutAnchors=[...html.matchAll(/<a\b[^>]*>/g)]
      .map(match=>attributes(match[0])).filter(attrs=>attrs.class?.split(/\s+/).includes('checkout'));
    assert.equal(checkoutAnchors.length,2);
    for(const anchor of checkoutAnchors){
      assert.equal(anchor.href,'#pulso-test-checkout');
      assert.equal(anchor['data-checkout-url'],'https://pay.hotmart.com/X108204659G');
    }
    const hrefs=[...html.matchAll(/\bhref="([^"]+)"/g)].map(match=>match[1]);
    assert.ok(!hrefs.some(href=>href.includes('pay.hotmart.com')));
    assert.match(html,/id="pulso-consent-title"/);
    assert.match(html,/id="pulso-deny"/);
    assert.match(html,/id="pulso-revoke"[^>]*hidden/);
    assert.match(html,/compras desativadas/);
  });
});

test('preview policy blocks advertising transports and limits collector traffic to isolated Supabase',async()=>{
  await builtPreview(async({html})=>{
    const metas=[...html.matchAll(/<meta\b[^>]*>/g)].map(match=>attributes(match[0]));
    const policy=metas.find(meta=>meta['http-equiv']==='Content-Security-Policy')?.content;
    assert.ok(policy);
    const directives=Object.fromEntries(policy.split(';').map(value=>value.trim().split(/\s+/)).filter(tokens=>tokens[0]).map(([key,...values])=>[key,values]));
    assert.deepEqual(directives['connect-src'],['https://osgumasejgumqlnqxcvm.supabase.co']);
    assert.deepEqual(directives['img-src'],["'self'",'data:']);
    for(const name of ['default-src','base-uri','form-action','frame-src','object-src'])assert.deepEqual(directives[name],["'none'"]);
    assert.deepEqual(metas.find(meta=>meta.name==='robots')?.content,'noindex,nofollow');
    assert.deepEqual(metas.find(meta=>meta.name==='referrer')?.content,'no-referrer');
    assert.ok(!policy.includes('facebook'));
  });
});

test('preview runtime permits only the exact private staging origin and campaign path',()=>{
  const {origin,path}=EMBARQUE_PREVIEW;
  for(const url of [origin+path,origin+path+'index.html',origin+path+'?utm_source=meta&fbclid=synthetic'])assert.equal(isEmbarquePreviewLocation(url),true,url);
  for(const url of [
    'https://ingles-de-embarque-black-mamba.netlify.app/',
    origin.replace('https:','http:')+path,
    origin+'.evil.test'+path,
    origin.replace('https://','https://user:password@')+path,
    origin+'/',origin+path+'other.html',origin+'/teste-ingles-de-embarque-extra/',
    'https://osgumasejgumqlnqxcvm.supabase.co'+path,'not a URL',
  ])assert.equal(isEmbarquePreviewLocation(url),false,url);
});

test('rebuilding an output for another project removes the agency-bound campaign copy',async()=>{
  await builtPreview(async({output,preview})=>{
    await stat(join(preview,'index.html'));
    const unrelated='zzzzzzzzzzzzzzzzzzzz';
    await buildStagingDashboard(env(unrelated),output);
    assert.equal(JSON.parse(await readFile(join(output,'config.json'),'utf8')).project_ref,unrelated);
    await assert.rejects(stat(preview),error=>error.code==='ENOENT');
  });
});

test('real SDK and preview controller collect only consented ordered test events with a resumable session',async()=>{
  const now=Date.parse('2026-10-29T12:00:00Z');
  const calls=[],statuses=[],values=new Map();let number=0,reads=0,session;
  const uuid=()=>`00000000-0000-4000-8000-${String(++number).padStart(12,'0')}`;
  const tracker=createPulsoTracker({
    collectorUrl:EMBARQUE_PREVIEW.collectorUrl,publicSiteKey:EMBARQUE_PREVIEW.publicSiteKey,
    marketingAllowed:()=>session?.allowed()===true,consentRecord:()=>session?.consentRecord(),
    currentUrl:()=>EMBARQUE_PREVIEW.origin+EMBARQUE_PREVIEW.path+'?utm_source=meta&fbclid=SYNTHETIC-CLICK&email=DO_NOT_SEND',
    cookieHeader:()=>{reads++;return '_fbp=synthetic-fbp';},
    sessionStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    randomUUID:uuid,now:()=>now,
    fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push({url,body});
      return Response.json(body.action==='revoke'?{ok:true}:{resume_token:'R'.repeat(30),expires_at:new Date(now+60*60*1000).toISOString()});
    },
  });
  session=createPreviewSession({tracker,now:()=>now,randomUUID:uuid,onStatus:status=>statuses.push(status)});
  await session.setVisible({isIntersecting:true,intersectionRatio:1});
  await session.checkout('https://pay.hotmart.com/SYNTHETIC-ONLY?off=keep&sck=existing');
  assert.equal(calls.length,0);assert.equal(reads,0);assert.equal(values.size,0);
  await session.accept();
  const clicked=await session.checkout('https://pay.hotmart.com/SYNTHETIC-ONLY?off=keep&sck=existing');
  assert.deepEqual(clicked,{sent:true,reason:'recorded'});
  assert.deepEqual(calls.map(call=>call.body.event_name),['page_view','view_content','checkout_click']);
  for(const call of calls){
    const url=new URL(call.url);
    assert.equal(url.origin,'https://osgumasejgumqlnqxcvm.supabase.co');
    assert.equal(url.pathname,'/functions/v1/pulso-collect');
    assert.equal(url.searchParams.get('site_key'),EMBARQUE_PREVIEW.publicSiteKey);
    assert.equal(call.body.consent.marketing,true);
    assert.equal(call.body.consent.policy_version,EMBARQUE_PREVIEW.policyVersion);
    assert.equal(call.body.consent.captured_at,new Date(now).toISOString());
    assert.equal(call.body.page_url,EMBARQUE_PREVIEW.origin+EMBARQUE_PREVIEW.path);
    assert.equal(call.body.click.email,undefined);
  }
  assert.equal(calls[0].body.resume_token,undefined);
  for(const call of calls.slice(1))assert.equal(call.body.resume_token,'R'.repeat(30));
  assert.ok(!JSON.stringify(statuses).includes('R'.repeat(30)));
  assert.ok(!JSON.stringify(calls).includes('DO_NOT_SEND'));
  assert.ok(!calls.some(call=>['checkout_started','purchase','Purchase'].includes(call.body.event_name)));
  await session.revoke();assert.equal(session.allowed(),false);
  assert.equal(calls.at(-1).body.action,'revoke');
  assert.ok([...values.keys()].every(key=>!key.includes(':resume:')));
});
