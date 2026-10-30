import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isolatedDatabase,seedWorkspaces,asUser,ids} from './helpers.mjs';
import {createCollector} from '../../supabase/functions/_shared/collector.mjs';
import {sha256} from '../../supabase/functions/_shared/handoff.mjs';

test('PostgreSQL collector retry identity, site binding, distributed limits, TTL and grants',async t=>{
 const fixture=await isolatedDatabase();const {db}=fixture;
 try{
  await seedWorkspaces(db);
  const origin='https://ingles.example.test',site='fixture_collector_site',other='fixture_collector_other';
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.a]);
  for(const key of [site,other])await db.query('select public.configure_tracking_site($1,$2,$3,$4)',[ids.wa,key,[origin],'fixture-v1']);
  const rpc=async(name,args)=>{
   const keys=Object.keys(args);assert.match(name,/^[a-z_]+$/);keys.forEach(k=>assert.match(k,/^[a-z_]+$/));
   await db.query('begin');try{await db.query('set local role service_role');const q=await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,Object.values(args));await db.query('commit');return q.rows[0].result;}catch(e){await db.query('rollback');throw e;}
  };
  const collector=createCollector({rpc,handoffKey:'synthetic-collector-secret-more-than-32-characters'});
  const capture=async(eventId=randomUUID(),resume,siteKey=site)=>{
   const input={site_key:siteKey,event_id:eventId,event_name:'page_view',page_url:origin+'/',click:{utm_source:'meta',utm_campaign:'unknown-email@example.test',xcod:'private-affiliate',gclid:'private-click'},browser:{fbp:'fb.1.123.synthetic',fbc:null},consent:{marketing:true,basis:'consent',policy_version:'fixture-v1',captured_at:new Date().toISOString()}};
   if(resume)input.resume_token=resume;
   return collector(new Request('https://collector.example.test/',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)}));
  };
  let token,eventId=randomUUID();
  await t.test('response-loss retry without resume recovers original identity and fixed expiry',async()=>{
   const first=await capture(eventId);assert.equal(first.status,200);const a=await first.json();token=a.resume_token;
   const replay=await capture(eventId);assert.equal(replay.status,200);const b=await replay.json();assert.equal(b.duplicate,true);assert.equal(b.expires_at,a.expires_at);
   assert.equal((await db.query('select count(*)::int n from public.tracking_sessions')).rows[0].n,1);
   assert.equal((await db.query('select count(*)::int n from private.visitor_match_context')).rows[0].n,1);
   assert.equal((await db.query('select count(*)::int n from public.funnel_events')).rows[0].n,1);
   const rows=(await db.query('select tracking_session_id from private.tracking_handoffs')).rows;assert.equal(rows.length,2);assert.equal(rows[0].tracking_session_id,rows[1].tracking_session_id);
  });
  await t.test('same workspace different site cannot replay event or resume a session',async()=>{
   assert.equal((await capture(eventId,undefined,other)).status,403);
   assert.equal((await capture(randomUUID(),token,other)).status,403);
   assert.equal((await db.query('select count(*)::int n from public.tracking_sessions')).rows[0].n,1);
  });
  await t.test('untrusted labels remain private and bearer event IDs cannot be queried by customers',async()=>{
   const safe=(await asUser(db,ids.a,'select utm_source,utm_campaign from public.tracking_sessions')).rows[0];assert.equal(safe.utm_source,'meta');assert.equal(safe.utm_campaign,null);
   assert.equal((await db.query('select click_ids from private.visitor_match_context')).rows[0].click_ids.xcod,'private-affiliate');
   for(const field of ['external_event_id','tracking_session_id','metadata','page_url'])await assert.rejects(asUser(db,ids.a,`select ${field} from public.funnel_events`),/permission denied/);
   assert.equal((await asUser(db,ids.a,'select event_name from public.funnel_events')).rows.length,1);
  });
  await t.test('site bucket limit is atomic, failing request does not add a session/event/handoff',async()=>{
   await db.query("update private.collector_rate_limits set requests=999 where bucket=$1 and window_at=date_trunc('minute',now())",['site:'+site]);
   assert.equal((await capture(randomUUID(),token)).status,200);
   const before=(await db.query('select count(*)::int n from public.funnel_events')).rows[0].n;
   assert.equal((await capture(randomUUID(),token)).status,429);
   assert.equal((await db.query('select count(*)::int n from public.funnel_events')).rows[0].n,before);
   await db.query("update private.collector_rate_limits set requests=1 where bucket=$1",['site:'+site]);
  });
  await t.test('expired signed resume and no-resume event replay are blocked; retention clears private matching',async()=>{
   await db.query("update private.tracking_handoffs set expires_at=now()-interval '2 days' where workspace_id=$1",[ids.wa]);
   await db.query("update private.visitor_match_context set captured_at=now()-interval '3 days',expires_at=now()-interval '2 days' where workspace_id=$1",[ids.wa]);
   assert.equal((await capture(randomUUID(),token)).status,403);
   assert.equal((await capture(eventId)).status,403);
   await db.query('select public.pulso_retention_cleanup()');
   assert.equal((await db.query('select count(*)::int n from private.visitor_match_context')).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int n from private.tracking_handoffs where token_sha256=$1',[await sha256(token)])).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int n from public.tracking_sessions')).rows[0].n,1);
  });
 }finally{await fixture.close();}
});
