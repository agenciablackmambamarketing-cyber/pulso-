import { mintHandoff, verifyHandoff, sha256 } from './handoff.mjs';
const MAX_BYTES=16_384;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS=new Set(['page_view','view_content','checkout_click','checkout_started']);
const CLICK_KEYS=new Set(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','src','sck','xcod','fbclid','gclid','gbraid','wbraid','tblci']);
const object=v=>v!==null && typeof v==='object' && !Array.isArray(v);
function fail(code,status=400){const e=new Error(code);e.status=status;throw e;}
function keysOnly(value,keys){if(!object(value)||Object.keys(value).some(k=>!keys.has(k)))fail('invalid_fields');}
export async function readSmallJSON(request,max=MAX_BYTES){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))fail('content_type',415);
  const stated=Number(request.headers.get('content-length'));if(stated>max)fail('payload_too_large',413);
  const reader=request.body?.getReader();if(!reader)fail('invalid_json');
  let size=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail('payload_too_large',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  try {const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!object(value))fail('invalid_json');return value;}catch(e){if(e.status)throw e;fail('invalid_json');}
}
export function validateCollectorInput(input,config,origin,now=Date.now()) {
  keysOnly(input,new Set(['site_key','event_id','event_name','page_url','click','browser','consent','resume_token','action']));
  if(input.action==='revoke'){
    if(Object.keys(input).some(k=>!['site_key','resume_token','action'].includes(k)))fail('invalid_revocation');
    if(typeof input.resume_token!=='string')fail('invalid_resume');return input;
  }
  if(input.action!==undefined)fail('invalid_action');
  if(!UUID.test(input.event_id||'')||!EVENTS.has(input.event_name))fail('invalid_event');
  let page;try{page=new URL(input.page_url);}catch{fail('invalid_page');}
  if(page.origin!==origin||page.protocol!=='https:'||page.username||page.password||page.search||page.hash||input.page_url.length>2048)fail('invalid_page');
  keysOnly(input.click,CLICK_KEYS);
  for(const value of Object.values(input.click)){if(typeof value!=='string'||!value||value.length>250||/[\u0000-\u001f\u007f]/.test(value))fail('invalid_click');}
  keysOnly(input.browser,new Set(['fbp','fbc']));
  for(const [key,value] of Object.entries(input.browser)){if(value!==null&&(typeof value!=='string'||value.length>250||!/^fb\.[0-9]+\.[0-9]+\.[A-Za-z0-9_-]+$/.test(value)))fail('invalid_'+key);}
  keysOnly(input.consent,new Set(['marketing','policy_version','captured_at','basis']));
  const consent=input.consent;const captured=Date.parse(consent.captured_at);
  if(consent.marketing!==true||consent.policy_version!==config.consent_policy_version||consent.basis!=='consent'||!Number.isFinite(captured)||captured>now+60_000||captured<now-86400_000)fail('consent_required',403);
  if(input.resume_token!==undefined&&typeof input.resume_token!=='string')fail('invalid_resume');
  return input;
}
export function trustedClientIP(request,headerName){
  // Set only after ingress is verified to REMOVE caller-supplied values and set
  // its own single IP. X-Forwarded-For is deliberately unsupported.
  if(!['cf-connecting-ip','x-real-ip'].includes(headerName))return null;
  const value=request.headers.get(headerName)?.trim();
  if(!value||value.includes(',')||value.length>45)return null;
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)&&value.split('.').every(n=>Number(n)<=255))return value;
  if(value.includes(':')&&/^[0-9a-f:]+$/i.test(value))return value;
  return null;
}
/** Dependency-injected actual Edge handler; tests exercise Request/Response. */
export function createCollector({rpc,handoffKey,ipHashKey,trustedIPHeader='',now=()=>Date.now()}){
 return async request=>{
  const origin=request.headers.get('origin');let cors={};
  const respond=(body,status=200)=>new Response(body===null?null:JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'}});
  try{
   if(!origin||origin==='null')fail('origin_denied',403);
   if(!['POST','OPTIONS'].includes(request.method))return respond({error:'method_not_allowed'},405);
   const input=request.method==='POST'?await readSmallJSON(request):null;
   const siteKey=input?.site_key||new URL(request.url).searchParams.get('site_key');
   if(typeof siteKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(siteKey))fail('invalid_site');
   const config=await rpc('pulso_site_config',{p_site_key:siteKey});
   if(!config?.active||!Array.isArray(config.allowed_origins)||!config.allowed_origins.includes(origin))fail('origin_denied',403);
   cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type','Access-Control-Max-Age':'600'};
   if(request.method==='OPTIONS')return respond(null,204);
   validateCollectorInput(input,config,origin,now());
   let resumeHash=null;
   if(input.resume_token){if(!await verifyHandoff(input.resume_token,handoffKey))fail('invalid_resume',403);resumeHash=await sha256(input.resume_token);}
   if(input.action==='revoke'){
    if(!resumeHash)fail('invalid_resume',403);
    await rpc('pulso_revoke_session',{p_site_key:siteKey,p_origin:origin,p_resume_hash:resumeHash});
    return respond({ok:true,revoked:true});
   }
   const handoff=await mintHandoff(handoffKey);
   const clientIP=trustedClientIP(request,trustedIPHeader);
   const ipHash=clientIP&&ipHashKey?await sha256(ipHashKey+':'+clientIP):null;
   const result=await rpc('pulso_record_event',{p_site_key:siteKey,p_origin:origin,p_input:input,p_handoff_hash:await sha256(handoff),p_handoff_expires_at:new Date(now()+86400_000).toISOString(),p_ip_hash:ipHash,p_client_ip:clientIP,p_user_agent:(request.headers.get('user-agent')||'').slice(0,512)||null,p_resume_hash:resumeHash});
   return respond({ok:true,duplicate:result.duplicate===true,checkout_handoff_token:handoff,resume_token:handoff,expires_at:result.expires_at});
  }catch(error){const message=error.message||'';const status=error.status||(/rate_limit/.test(message)?429:/invalid_resume|consent|origin_denied/.test(message)?403:503);return respond({error:status===503?'collector_unavailable':status===429?'rate_limit':message.replace(/[^a-z_]/g,'').slice(0,50)||'invalid_request'},status);}
 };
}
