import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isolatedDatabase,seedWorkspaces,ids,asUser,asRole} from './helpers.mjs';
import {sealCredential} from '../../supabase/functions/_shared/meta.mjs';
import {handleMetaWorker} from '../../supabase/functions/_shared/meta-worker.mjs';

test('PostgreSQL Meta queue tenant isolation, leases, retries, revocation and retention',async t=>{
 const {db,close}=await isolatedDatabase();
 try {
  await seedWorkspaces(db);
  const credentialKey=Buffer.alloc(32,31).toString('base64');
  const dataset='123456789012345',workerSecret='synthetic-meta-worker-secret-over-32-chars';
  const credential={access_token:'synthetic-token-not-real',dataset_id:dataset,mode:'test',test_event_code:'TEST_FIXTURE'};
  const sealed=await sealCredential(credential,ids.wa,dataset,credentialKey);
  const rpc=async(name,args)=>{
   assert.match(name,/^[a-z_]+$/);const names=Object.keys(args);names.forEach(n=>assert.match(n,/^[a-z_]+$/));
   return (await db.query(`select public.${name}(${names.map((n,i)=>`${n}=>$${i+1}`).join(',')}) result`,Object.values(args))).rows[0].result;
  };
  const save=async(ciphertext=sealed)=>rpc('pulso_meta_save',{p_workspace_id:ids.wa,p_user_id:ids.a,p_dataset_id:dataset,p_ciphertext:ciphertext,p_mode:'test'});
  const destination=await save();
  const session=randomUUID();
  await db.query("insert into public.tracking_sessions(id,workspace_id,public_session_id,landing_page) values($1,$2,$3,'https://fixture.invalid/')",[session,ids.wa,randomUUID()]);
  await db.query("insert into private.visitor_match_context(workspace_id,tracking_session_id,marketing_allowed,legal_basis_record,consent_captured_at,consent_policy_version,expires_at) values($1,$2,true,'consent',now(),'v1',now()+interval '1 day')",[ids.wa,session]);
  const enqueue=async()=>{
   const sale=randomUUID(),id=randomUUID();
   await db.query("insert into public.sales(id,workspace_id,provider,external_transaction_id,product_name,currency,gross_amount,status,purchased_at) values($1,$2,'hotmart',$3,'Synthetic product','BRL',197.50,'APPROVED',now())",[sale,ids.wa,randomUUID()]);
   await db.query("insert into public.attributions(workspace_id,sale_id,tracking_session_id,method,confidence) values($1,$2,$3,'session_id','high')",[ids.wa,sale,session]);
   await db.query("insert into private.conversion_event_outbox(id,workspace_id,destination_ref,sale_id,tracking_session_id,provider,event_name,event_id,event_time,value,currency,consent_basis,consent_captured_at,email_sha256,phone_sha256,fbp,client_ip) values($1,$2,$3,$4,$5,'meta','Purchase',$6,now(),197.50,'BRL','consent',now(),$7,$8,'fb.1.123.synthetic','192.0.2.1')",[id,ids.wa,destination,sale,session,'a'.repeat(32)+randomUUID().replaceAll('-',''),'b'.repeat(64),'c'.repeat(64)]);
   return {id,sale};
  };
  const finish=async(row,token=row.lease_token,accepted=true)=>rpc('pulso_meta_finish',{p_id:row.id,p_lease_token:token,p_accepted:accepted,p_retryable:!accepted,p_http_status:accepted?200:503,p_meta_error_code:accepted?null:2,p_error_code:accepted?null:'meta_transient',p_response_id:accepted?'fixture_trace':null});
  const claim=()=>rpc('pulso_meta_claim',{p_limit:1});
  await t.test('unauthorized tenant cannot configure/control another workspace; authenticated cannot invoke worker RPC',async()=>{
   await assert.rejects(rpc('pulso_meta_save',{p_workspace_id:ids.wa,p_user_id:ids.b,p_dataset_id:dataset,p_ciphertext:sealed,p_mode:'test'}),/Workspace access denied/);
   await assert.rejects(rpc('pulso_meta_control',{p_workspace_id:ids.wb,p_user_id:ids.b,p_destination_ref:destination,p_action:'revoke'}),/Destination not found/);
   await assert.rejects(asUser(db,ids.a,'select public.pulso_meta_claim(1)'),/permission denied/);
   await assert.rejects(asRole(db,'anon','select * from private.meta_capi_credentials'),/permission denied/);
   await assert.rejects(asUser(db,ids.a,'select ciphertext from private.meta_capi_credentials'),/permission denied/);
  });
  await t.test('claim is exclusive, wrong/stale leases cannot ACK; retry keeps logical event_id',async()=>{
   const queued=await enqueue();const [first]=await claim();assert.equal(first.id,queued.id);assert.equal((await claim()).length,0);
   assert.equal(await finish(first,randomUUID()),false);
   await db.query("update private.conversion_event_outbox set lease_expires_at=now()-interval '1 second' where id=$1",[first.id]);
   const [second]=await claim();assert.equal(second.id,first.id);assert.notEqual(second.lease_token,first.lease_token);assert.equal(second.event_id,first.event_id);
   assert.equal(await finish(first),false);assert.equal(await finish(second),true);
   assert.equal((await db.query('select status from private.conversion_event_outbox where id=$1',[queued.id])).rows[0].status,'delivered');
  });
  await t.test('crashed eighth attempt becomes terminal attempts_exhausted',async()=>{
   const queued=await enqueue();await db.query("update private.conversion_event_outbox set status='sending',attempt_count=8,lease_token=$2,lease_expires_at=now()-interval '1 second' where id=$1",[queued.id,randomUUID()]);
   assert.equal((await claim()).length,0);
   const row=(await db.query('select status,last_error_code,lease_token from private.conversion_event_outbox where id=$1',[queued.id])).rows[0];
   assert.equal(row.status,'failed');assert.equal(row.last_error_code,'attempts_exhausted');assert.equal(row.lease_token,null);
  });
  await t.test('credential rotation fences leases; revoked destination blocks jobs and removes credential',async()=>{
   const queued=await enqueue();const [old]=await claim();assert.equal(old.id,queued.id);
   await save(await sealCredential({...credential,access_token:'synthetic-replacement-token'},ids.wa,dataset,credentialKey));
   assert.equal(await rpc('pulso_meta_lease_valid',{p_id:old.id,p_lease_token:old.lease_token}),false);
   assert.equal(await finish(old),false);
   const [fresh]=await claim();assert.notEqual(fresh.lease_token,old.lease_token);
   await rpc('pulso_meta_control',{p_workspace_id:ids.wa,p_user_id:ids.a,p_destination_ref:destination,p_action:'revoke'});
   assert.equal(await finish(fresh),false);assert.equal((await claim()).length,0);
   assert.equal((await db.query('select count(*)::int n from private.meta_capi_credentials where destination_ref=$1',[destination])).rows[0].n,0);
   assert.equal((await db.query('select status from private.conversion_event_outbox where id=$1',[queued.id])).rows[0].status,'failed');
   await save();
  });
  await t.test('reprocessing cannot revive reversed sales or revoked consent',async()=>{
   const queued=await enqueue();const [claimed]=await claim();
   await db.query("update public.sales set status='REFUNDED' where id=$1",[queued.sale]);
   assert.equal(await rpc('pulso_meta_lease_valid',{p_id:claimed.id,p_lease_token:claimed.lease_token}),false);
   await db.query("update private.conversion_event_outbox set status='failed',lease_token=null,lease_expires_at=null where id=$1",[queued.id]);
   assert.equal(await rpc('pulso_meta_control',{p_workspace_id:ids.wa,p_user_id:ids.a,p_destination_ref:destination,p_action:'reprocess',p_outbox_id:queued.id}),false);
   const revoked=await enqueue();await db.query('update private.visitor_match_context set marketing_allowed=false where tracking_session_id=$1',[session]);
   assert.equal((await claim()).length,0);
   assert.equal(await rpc('pulso_meta_control',{p_workspace_id:ids.wa,p_user_id:ids.a,p_destination_ref:destination,p_action:'reprocess',p_outbox_id:revoked.id}),false);
   await db.query('update private.visitor_match_context set marketing_allowed=true where tracking_session_id=$1',[session]);
  });
  await t.test('missing credentials/config and malformed envelope cannot cause any network conversion',async()=>{
   const queued=await enqueue();await db.query('delete from private.meta_capi_credentials where destination_ref=$1',[destination]);
   assert.equal((await claim()).length,0);await save('invalid-encrypted-envelope');
   let sends=0;const invoke=async(key=credentialKey)=>handleMetaWorker(new Request('https://worker.invalid/',{method:'POST',headers:{'x-pulso-worker-secret':workerSecret}}),{rpc,workerSecret,credentialKey:key,version:'v25.0',fetchImpl:async()=>{sends++;return Response.json({events_received:1});}});
   assert.equal((await invoke('')).status,503);const processed=await invoke();assert.equal((await processed.json()).failed,1);assert.equal(sends,0);
   assert.equal((await db.query('select last_error_code from private.conversion_event_outbox where id=$1',[queued.id])).rows[0].last_error_code,'configuration_invalid');
   await save();
  });
  await t.test('expired personal matching scrub covers delivered records; dashboard only safe own projection',async()=>{
   await db.query("update private.visitor_match_context set captured_at=now()-interval '2 days',expires_at=now()-interval '1 second' where tracking_session_id=$1",[session]);
   await db.query('select private.pulso_scrub_expired_capi()');
   const records=(await db.query('select email_sha256,phone_sha256,fbp,client_ip from private.conversion_event_outbox')).rows;
   records.forEach(row=>Object.values(row).forEach(value=>assert.equal(value,null)));
   assert.equal((await asUser(db,ids.b,'select id from public.capi_delivery_diagnostics')).rows.length,0);
   const own=(await asUser(db,ids.a,'select * from public.capi_delivery_diagnostics')).rows;assert.ok(own.length>0);
   for(const row of own)for(const field of ['email_sha256','client_ip','ciphertext','event_id'])assert.equal(row[field],undefined);
  });
 }finally{await close();}
});
