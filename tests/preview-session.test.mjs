import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewSession, CONTENT_VISIBILITY_RATIO, PREVIEW_CONSENT_POLICY} from '../tracker/preview-session.mjs';

const start = Date.parse('2026-10-29T12:00:00Z');
const checkoutURL = 'https://pay.hotmart.com/TEST-ONLY?off=kept&sck=existing&xcod=kept';
const deferred = () => { let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve}; };
function fixture(overrides={}) {
  const events=[],statuses=[],revocations=[];let time=start,number=0;
  const tracker={track:async(name,options)=>{events.push({name,...options});return {sent:true,event_id:options.eventId,resume_token:'DO_NOT_EXPOSE'};},revokeConsent:async()=>{revocations.push(true);return {sent:true,reason:'revoked'};},checkoutHref:()=>assert.fail('Preview must never decorate or expose a real checkout link'),...overrides};
  const session=createPreviewSession({tracker,now:()=>time,randomUUID:()=>`00000000-0000-4000-8000-${String(++number).padStart(12,'0')}`,onStatus:value=>statuses.push(value)});
  return {session,events,statuses,revocations,setTime:value=>{time=value;},tracker};
}

test('preview starts with no consent and only explicit acceptance supplies a current versioned record',async()=>{
  const f=fixture();
  assert.equal(f.session.allowed(),false);assert.equal(f.session.consentRecord(),null);
  await f.session.setVisible({isIntersecting:true,intersectionRatio:1});
  assert.deepEqual(await f.session.checkout(checkoutURL),{sent:false,reason:'consent_required'});
  assert.equal(f.events.length,0);
  await f.session.accept();
  assert.deepEqual(f.events.map(e=>e.name),['page_view','view_content']);
  assert.deepEqual(f.session.consentRecord(),{marketing:true,basis:'consent',policy_version:PREVIEW_CONSENT_POLICY,captured_at:new Date(start).toISOString()});
  const record=f.session.consentRecord();record.marketing=false;
  assert.equal(f.session.consentRecord().marketing,true);
  assert.ok(!JSON.stringify(f.statuses).includes('DO_NOT_EXPOSE'));
});

test('content requires current 50 percent visibility and is never sent retroactively after acceptance',async()=>{
  const f=fixture();assert.equal(CONTENT_VISIBILITY_RATIO,.5);
  await f.session.setVisible({isIntersecting:true,intersectionRatio:1});
  await f.session.setVisible({isIntersecting:false,intersectionRatio:0});
  await f.session.accept();
  for(const entry of [{isIntersecting:true,intersectionRatio:.49},{isIntersecting:false,intersectionRatio:1},{isIntersecting:true,intersectionRatio:NaN},{isIntersecting:true,intersectionRatio:2}])await f.session.setVisible(entry);
  assert.deepEqual(f.events.map(e=>e.name),['page_view']);
  await f.session.setVisible({isIntersecting:true,intersectionRatio:.5});
  await f.session.setVisible({isIntersecting:true,intersectionRatio:1});
  assert.deepEqual(f.events.map(e=>e.name),['page_view','view_content']);
});

test('content becoming hidden while PageView is in flight does not emit a historical view',async()=>{
  const gate=deferred();const events=[];
  const f=fixture({track:async(name,options)=>{events.push({name,...options});if(name==='page_view')await gate.promise;return {sent:true};}});
  await f.session.setVisible({isIntersecting:true,intersectionRatio:1});
  const accepted=f.session.accept();await Promise.resolve();
  const hidden=f.session.setVisible({isIntersecting:false,intersectionRatio:0});
  gate.resolve();await accepted;await hidden;
  assert.deepEqual(events.map(e=>e.name),['page_view']);
});

test('failed collection retries the same logical PageView and ViewContent IDs before checkout',async()=>{
  const events=[];let pageAttempts=0,viewAttempts=0;
  const f=fixture({track:async(name,options)=>{events.push({name,...options});if(name==='page_view'&&++pageAttempts===1)throw new Error('DO_NOT_EXPOSE');if(name==='view_content'&&++viewAttempts===1)return {sent:false,reason:'DO_NOT_EXPOSE'};return {sent:true,resume_token:'DO_NOT_EXPOSE'};}});
  await f.session.setVisible({isIntersecting:true,intersectionRatio:1});
  assert.equal((await f.session.accept()).sent,false);
  await f.session.accept();
  const reply=await f.session.checkout(checkoutURL);
  assert.equal(reply.sent,true);
  assert.deepEqual(Object.keys(reply).sort(),['reason','sent']);
  const pages=events.filter(e=>e.name==='page_view'),views=events.filter(e=>e.name==='view_content');
  assert.equal(pages.length,2);assert.equal(new Set(pages.map(e=>e.eventId)).size,1);
  assert.equal(views.length,2);assert.equal(new Set(views.map(e=>e.eventId)).size,1);
  assert.deepEqual(events.map(e=>e.name),['page_view','page_view','view_content','view_content','checkout_click']);
  assert.ok(!JSON.stringify(f.statuses).includes('DO_NOT_EXPOSE'));
});

test('a fast actual click waits for PageView; pending double-clicks share a logical click ID',async()=>{
  const gate=deferred();const events=[];
  const f=fixture({track:async(name,options)=>{events.push({name,...options});if(name==='page_view')await gate.promise;return {sent:true};}});
  const accepted=f.session.accept(),first=f.session.checkout(checkoutURL),second=f.session.checkout(checkoutURL);
  await Promise.resolve();assert.deepEqual(events.map(e=>e.name),['page_view']);
  gate.resolve();await Promise.all([accepted,first,second]);
  assert.deepEqual(events.map(e=>e.name),['page_view','checkout_click']);
  await f.session.checkout(checkoutURL);
  assert.deepEqual(events.map(e=>e.name),['page_view','checkout_click','checkout_click']);
  assert.notEqual(events[1].eventId,events[2].eventId);
  assert.equal(checkoutURL,'https://pay.hotmart.com/TEST-ONLY?off=kept&sck=existing&xcod=kept');
  assert.ok(!events.some(e=>['checkout_started','purchase','Purchase'].includes(e.name)));
});

test('failed click retry retains its ID and malformed or foreign checkout links cannot collect',async()=>{
  const events=[];let clicked=0;
  const f=fixture({track:async(name,options)=>{events.push({name,...options});return {sent:name!=='checkout_click'||++clicked>1};}});
  await f.session.accept();
  for(const url of ['http://pay.hotmart.com/TEST','https://evil.test/','https://pay.hotmart.com.evil.test/','https://name:pass@pay.hotmart.com/','https://pay.hotmart.com:444/','not a URL'])assert.equal((await f.session.checkout(url)).reason,'checkout_url_invalid');
  assert.equal(events.length,1);
  assert.equal((await f.session.checkout(checkoutURL)).sent,false);
  assert.equal((await f.session.checkout(checkoutURL)).sent,true);
  assert.equal(events[1].eventId,events[2].eventId);
});

test('denial and revocation immediately stop measurement, including in-flight quick reacceptance',async()=>{
  const gate=deferred(),events=[],states=[],revocations=[];let calls=0;let f;
  f=fixture({track:async(name,options)=>{events.push({name,...options});if(++calls===1){await gate.promise;states.push(f.session.allowed());}return {sent:true};},revokeConsent:async()=>{states.push(f.session.allowed());revocations.push(true);return {sent:true};}});
  const accepted=f.session.accept();await Promise.resolve();assert.equal(f.session.allowed(),true);
  const revoked=f.session.revoke();assert.equal(f.session.allowed(),false);assert.equal(f.session.consentRecord(),null);
  const acceptedAgain=f.session.accept();assert.equal(f.session.allowed(),false);
  gate.resolve();await Promise.all([accepted,revoked,acceptedAgain]);
  assert.deepEqual(states,[false,false]);
  assert.equal(revocations.length,1);assert.equal(f.session.allowed(),true);
  assert.deepEqual(events.map(e=>e.name),['page_view','page_view']);assert.notEqual(events[0].eventId,events[1].eventId);
  await f.session.deny();assert.equal(f.session.allowed(),false);
  await f.session.setVisible({isIntersecting:true,intersectionRatio:1});await f.session.checkout(checkoutURL);
  assert.equal(events.length,2);
});

test('consent expires at24 hours without implicit refresh and explicit reacceptance starts a new consent record',async()=>{
  const f=fixture();await f.session.accept();const oldRecord=f.session.consentRecord();
  f.setTime(start+24*60*60*1000);
  assert.equal(f.session.allowed(),false);assert.equal(f.session.consentRecord(),null);
  assert.equal((await f.session.checkout(checkoutURL)).reason,'consent_expired');
  await f.session.accept();assert.equal(f.session.allowed(),true);
  assert.notEqual(f.session.consentRecord().captured_at,oldRecord.captured_at);
  assert.equal(f.revocations.length,1);
  assert.deepEqual(f.events.map(e=>e.name),['page_view','page_view']);
});

test('revocation while content is in flight suppresses its success and all queued checkout work',async()=>{
  const gate=deferred(),events=[];let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({track:async(name,options)=>{events.push({name,...options});if(name==='view_content'){entered();await gate.promise;}return {sent:true};}});
  await f.session.accept();
  const viewed=f.session.setVisible({isIntersecting:true,intersectionRatio:1});await started;
  const clicked=f.session.checkout(checkoutURL),revoked=f.session.revoke();
  assert.equal(f.session.allowed(),false);
  gate.resolve();assert.equal((await viewed).sent,false);assert.equal((await clicked).sent,false);await revoked;
  assert.deepEqual(events.map(e=>e.name),['page_view','view_content']);
  assert.ok(!f.statuses.some(s=>s.event==='view_content'&&s.sent));
});

test('privacy failures remain pending and provider details or status callback errors cannot leak or enable consent',async()=>{
  const f=fixture({revokeConsent:async()=>{throw new Error('DO_NOT_EXPOSE');}});
  await f.session.accept();assert.deepEqual(await f.session.revoke(),{sent:false,reason:'revocation_pending'});
  assert.equal(f.session.allowed(),false);assert.ok(!JSON.stringify(f.statuses).includes('DO_NOT_EXPOSE'));
  const session=createPreviewSession({tracker:f.tracker,now:()=>NaN,onStatus:()=>{throw new Error('callback');}});
  assert.deepEqual(await session.accept(),{sent:false,reason:'clock_unavailable'});
  assert.equal(session.allowed(),false);
});
