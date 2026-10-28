import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHotmartEvent,acceptHotmartState,readHotmartBody} from '../supabase/functions/_shared/hotmart.mjs';
const now=Date.now();
const sample=(event='PURCHASE_APPROVED',status='APPROVED')=>({id:'event-1',event,version:'2.0.0',creation_date:now,data:{product:{id:123,name:'Synthetic training offer'},purchase:{transaction:'HPTEST1',status,full_price:{value:149.9,currency_value:'BRL'},approved_date:now}}});
test('Hotmart validates authenticated event shape without returning buyer PII',()=>{
 const p=sample();p.data.buyer={email:'synthetic@example.invalid'};
 assert.deepEqual(validateHotmartEvent(p,now),{status:'APPROVED',transaction:'HPTEST1',eventId:'event-1'});
});
test('status in event and purchase must agree; arbitrary PURCHASE name rejected',()=>{
 assert.throws(()=>validateHotmartEvent(sample('PURCHASE_REFUNDED','APPROVED')),/status/);
 assert.throws(()=>validateHotmartEvent(sample('PURCHASE_FAKE','APPROVED')),/Invalid Hotmart/);
 assert.equal(validateHotmartEvent(sample('PURCHASE_BILLET_PRINTED','PRINTED_BILLET')).status,'PRINTED_BILLET');
});
test('money and product fields must exist; zero is distinct from missing',()=>{
 for(const value of [NaN,Infinity,-1,'149.9',undefined]){const p=sample();p.data.purchase.full_price.value=value;assert.throws(()=>validateHotmartEvent(p),/money/);}
 const p=sample();p.data.purchase.full_price.value=0;assert.doesNotThrow(()=>validateHotmartEvent(p));
 p.data.product.id=undefined;assert.throws(()=>validateHotmartEvent(p),/product/);
});
test('future timestamps rejected and metadata cannot invent approval',()=>{
 const p=sample();p.creation_date=now+300001;assert.throws(()=>validateHotmartEvent(p,now),/timestamp/);
 const pending=sample('PURCHASE_DELAYED','OVERDUE');assert.equal(validateHotmartEvent(pending).status,'OVERDUE');
});
test('reversal wins even when older; delayed approval never resurrects terminal sale',()=>{
 assert.equal(acceptHotmartState({status:'APPROVED',at:30},{status:'REFUNDED',at:10}),true);
 assert.equal(acceptHotmartState({status:'REFUNDED',at:30},{status:'APPROVED',at:40}),false);
 assert.equal(acceptHotmartState({status:'REFUNDED',at:30},{status:'CHARGEBACK',at:10}),true);
 assert.equal(acceptHotmartState({status:'CHARGEBACK',at:30},{status:'REFUNDED',at:40}),false);
 assert.equal(acceptHotmartState({status:'COMPLETE',at:30},{status:'APPROVED',at:40}),false);
 assert.equal(acceptHotmartState({status:'APPROVED',at:30},{status:'OVERDUE',at:40}),false);
});
test('body limit uses received bytes even with absent Content-Length',async()=>{
 const body=JSON.stringify({...sample(),extra:'ã'.repeat(65000)});
 const req=new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json'},body});
 await assert.rejects(readHotmartBody(req),/Payload too large/);
 const valid=new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sample())});
 assert.equal((await readHotmartBody(valid)).id,'event-1');
});

test('handler rejects missing Hottok before touching database, authenticates before accepting',async()=>{
 const {createHotmartHandler}=await import('../supabase/functions/_shared/hotmart.mjs');let calls=0;
 const handler=createHotmartHandler({rpc:async()=>{calls++;return {error:{message:'Unauthorized Hotmart source'}};},verifyHandoff:async()=>false,sha256:async()=>''});
 const req=headers=>new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(sample())});
 assert.equal((await handler(req({}))).status,401);assert.equal(calls,0);
 assert.equal((await handler(req({'x-hotmart-hottok':'synthetic-invalid-token'}))).status,401);assert.equal(calls,1);
});
test('handler verifies handoff cryptographically; never trusts browser tenant or IP fields',async()=>{
 const {createHotmartHandler}=await import('../supabase/functions/_shared/hotmart.mjs');let captured;
 const handler=createHotmartHandler({rpc:async(_,args)=>{captured=args;return {data:{accepted:true}};},handoffKey:'synthetic-key',verifyHandoff:async value=>value==='valid',sha256:async()=> 'a'.repeat(64)});
 const p=sample();p.data.purchase.origin={sck:'forged'};p.workspace_id='attacker';p.client_ip='forged';
 const req=()=>new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json','x-hotmart-hottok':'synthetic-hotmart-token'},body:JSON.stringify(p)});
 assert.equal((await handler(req())).status,200);assert.equal(captured.p_handoff_hash,null);
 p.data.purchase.origin.sck='valid';assert.equal((await handler(req())).status,200);assert.equal(captured.p_handoff_hash,'a'.repeat(64));
 assert.deepEqual(Object.keys(captured).sort(),['p_handoff_hash','p_hottok','p_payload']);
});
test('prototype member names are never supported Hotmart events',()=>{
 for(const name of ['constructor','toString','__proto__']){
  const p=sample();p.event=name;delete p.data.purchase.status;assert.throws(()=>validateHotmartEvent(p),/Invalid Hotmart/);
 }
});
