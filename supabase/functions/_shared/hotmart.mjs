/** Hotmart V2 request validation shared by the deployed handler and Node tests.
 * Buyer data is processed only in the private SQL transaction after valid consent.
 * This module deliberately does not log payloads or expose buyer fields.
 */
const STATUS = Object.freeze({
  PURCHASE_APPROVED: 'APPROVED', PURCHASE_COMPLETE: 'COMPLETE',
  PURCHASE_REFUNDED: 'REFUNDED', PURCHASE_CHARGEBACK: 'CHARGEBACK',
  PURCHASE_CANCELED: 'CANCELLED', PURCHASE_EXPIRED: 'EXPIRED',
  PURCHASE_DELAYED: 'OVERDUE', PURCHASE_PROTEST: 'PROTESTED',
  PURCHASE_BILLET_PRINTED: 'PRINTED_BILLET',
});
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const approved = s => ['APPROVED','COMPLETE'].includes(s);
const terminal = s => ['REFUNDED','CHARGEBACK'].includes(s);
export class HotmartInputError extends Error {}
function fail(message) { throw new HotmartInputError(message); }
export function validateHotmartEvent(payload, now = Date.now()) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') fail('Invalid Hotmart event');
  const purchase=payload.data?.purchase, product=payload.data?.product;
  if (payload.version !== '2.0.0' || typeof payload.id!=='string' || typeof purchase?.transaction!=='string' || !ID.test(payload.id ?? '') || !ID.test(purchase?.transaction ?? '') || !Object.hasOwn(STATUS,payload.event)) fail('Invalid Hotmart event');
  const expected=STATUS[payload.event];
  let actual=purchase.status;
  if (actual==='CANCELED') actual='CANCELLED';
  if (actual==='DELAYED') actual='OVERDUE';
  if (actual != null && actual !== expected) fail('Invalid event status');
  if (!Number.isSafeInteger(payload.creation_date) || payload.creation_date < 946684800000 || payload.creation_date > now + 300000) fail('Invalid event timestamp');
  const money=purchase.full_price;
  if (typeof money?.value !== 'number' || !Number.isFinite(money.value) || money.value<0 || money.value>9999999999.99 || !/^[A-Z]{3}$/.test(money.currency_value ?? '')) fail('Invalid money amount');
  const productId=product?.ucode ?? product?.id;
  if (!['string','number'].includes(typeof productId) || !ID.test(String(productId)) || typeof product?.name!=='string' || !product.name.trim() || product.name.length>250) fail('Invalid product');
  if (purchase.approved_date != null && (!Number.isSafeInteger(purchase.approved_date) || purchase.approved_date<946684800000 || purchase.approved_date > now+300000)) fail('Invalid event timestamp');
  return {status:expected,transaction:purchase.transaction,eventId:payload.id};
}
/** Same state rules as ingest_hotmart_tracking_event. Final reversals win regardless of arrival order. */
export function acceptHotmartState(previous, next) {
  if (!previous) return true;
  if (terminal(previous.status)) return previous.status==='REFUNDED' && next.status==='CHARGEBACK';
  if (terminal(next.status)) return true;
  if (approved(previous.status) && !approved(next.status)) return false;
  if (previous.status==='COMPLETE' && next.status==='APPROVED') return false;
  return next.at >= previous.at;
}
export async function readHotmartBody(request, limit=128000) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) fail('Invalid content type');
  const contentLength=Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(contentLength) || contentLength<0 || contentLength>limit) fail('Payload too large');
  const reader=request.body?.getReader();
  if (!reader) fail('Malformed JSON');
  const chunks=[]; let total=0;
  for (;;) {
    const {done,value}=await reader.read(); if(done)break;
    total+=value.byteLength; if(total>limit){await reader.cancel();fail('Payload too large');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('Malformed JSON');}
  validateHotmartEvent(payload); return payload;
}

/** Injectable boundary used by the Edge Function and authentication tests. */
export function createHotmartHandler({rpc, verifyHandoff, sha256, handoffKey}) {
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  return async request=>{
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    const hottok=request.headers.get('x-hotmart-hottok');
    if(!hottok || hottok.length<12 || hottok.length>512)return json({error:'Unauthorized'},401);
    let payload;
    try{payload=await readHotmartBody(request);}catch(error){
      return json({error:error instanceof HotmartInputError ? error.message : 'Invalid event'},error.message==='Payload too large'?413:400);
    }
    let hash=null;
    try{
      const token=payload.data.purchase.origin?.sck;
      if(handoffKey && typeof token==='string' && await verifyHandoff(token,handoffKey))hash=await sha256(token);
      const {data,error}=await rpc('ingest_hotmart_tracking_event',{p_hottok:hottok,p_payload:payload,p_handoff_hash:hash});
      if(error){
        const denied=/Unauthorized Hotmart source/.test(error.message ?? '');
        const invalid=/Invalid Hotmart|Invalid event|Invalid money|Invalid product|Transaction facts changed/.test(error.message ?? '');
        return json({error:denied?'Unauthorized':invalid?'Invalid event':'Ingestion failed'},denied?401:invalid?400:503);
      }
      return json({ok:true,duplicate:data?.duplicate===true,accepted:data?.accepted===true});
    }catch{return json({error:'Ingestion unavailable'},503);}
  };
}
