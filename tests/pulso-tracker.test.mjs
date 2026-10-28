import test from 'node:test';
import assert from 'node:assert/strict';
import { createPulsoTracker } from '../tracker/pulso-tracker.mjs';

const validId='8d7aab93-e833-4741-aa3f-2d024c7790aa';
const opaqueToken='a'.repeat(32);
function setup(consent=true, href='https://ingles.example.com/?utm_campaign=teste&fbclid=clique&email=sensitive%40email.com') {
  const writes=[]; const store=new Map(); const requests=[]; let accepted=consent;
  const sdk=createPulsoTracker({
    collectorUrl:'https://pulso.example.com/functions/v1/pulso-collect',
    publicSiteKey:'agency_english_2026', marketingAllowed:()=>accepted,
    currentUrl:()=>href, cookieHeader:()=>'_fbp=fb.1.123.abc; _fbc=fb.1.123.clique; session=secret',
    randomUUID:()=>validId,
    sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>{writes.push([k,v]);store.set(k,v);},removeItem:k=>store.delete(k)},
    fetchImpl:async(url,opts)=>{requests.push({url,...opts});return {ok:true,json:async()=>({checkout_handoff_token:opaqueToken})};}
  });
  return {sdk,writes,requests,store,setConsent:v=>accepted=v};
}

test('no consent: no network request and no marketing storage',async()=>{
  const s=setup(false); const result=await s.sdk.track('page_view');
  assert.equal(result.sent,false); assert.equal(s.requests.length,0);assert.equal(s.writes.length,0);
  assert.equal(s.sdk.checkoutHref('https://pay.hotmart.com/X123?off=abc'),'https://pay.hotmart.com/X123?off=abc');
});
test('allowed fields only: never leak email or complete URL to collector',async()=>{
  const s=setup(); const res=await s.sdk.track('page_view');
  assert.equal(res.sent,true);
  const payload=JSON.parse(s.requests[0].body);
  assert.equal(payload.page_url,'https://ingles.example.com/');
  assert.equal(payload.click.fbclid,'clique');
  assert.equal(payload.click.utm_campaign,'teste');
  assert.equal(payload.click.email,undefined);
  assert.ok(!s.requests[0].body.includes('sensitive%40email.com'));
  assert.ok(!s.requests[0].body.includes('session=secret'));
  assert.equal(s.writes.length,1);
});
test('Hotmart checkout URL keeps existing affiliate/checkout params and never overwrites sck',async()=>{
  const s=setup();await s.sdk.track('checkout_click');
  const c=s.sdk.checkoutHref('https://pay.hotmart.com/X123?off=abc&utm_source=meta');
  const u=new URL(c);assert.equal(u.searchParams.get('off'),'abc');assert.equal(u.searchParams.get('utm_source'),'meta');
  assert.equal(u.searchParams.get('sck'),opaqueToken);
  const old='https://pay.hotmart.com/X123?sck=existing';assert.equal(s.sdk.checkoutHref(old),old);
  const outside='https://evil.example.com/buy';assert.equal(s.sdk.checkoutHref(outside),outside);
});
test('revoking consent blocks events and checkout decoration',async()=>{
  const s=setup();await s.sdk.track('page_view');s.setConsent(false);
  assert.equal((await s.sdk.track('view_content')).sent,false);
  const href='https://pay.hotmart.com/X123';assert.equal(s.sdk.checkoutHref(href),href);
  s.sdk.reset();assert.equal(s.store.size,0);
});
test('invalid URL and fake/small site keys rejected',async()=>{
  assert.throws(()=>createPulsoTracker({collectorUrl:'http://thirdparty.example.com/collect',publicSiteKey:'abc',marketingAllowed:()=>true}),/HTTPS/);
  const s=setup();await assert.rejects(s.sdk.track('purchase'),/Unsupported event/);
});