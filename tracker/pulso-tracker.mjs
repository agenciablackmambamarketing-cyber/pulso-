/** Consent-gated first-party SDK. A CMP must supply its actual policy/version
 * and captured-at record; this SDK does not fabricate consent evidence. */
const CLICK_KEYS=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','src','sck','xcod','fbclid','gclid','gbraid','wbraid','tblci'];
const EVENTS=new Set(['page_view','view_content','checkout_click','checkout_started']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDOFF=/^[A-Za-z0-9]{30}$/;
function secureURL(input){const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password)throw new TypeError('Use HTTPS without credentials');return u;}
function readCookie(header,name){const found=header.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));if(!found)return null;try{return decodeURIComponent(found.slice(name.length+1)).slice(0,250);}catch{return null;}}
function safeQuery(u){const data={};for(const key of CLICK_KEYS){const value=u.searchParams.get(key);if(value&&value.length<=250&&!/[\u0000-\u001f\u007f]/.test(value))data[key]=value;}return data;}
export function createPulsoTracker(config){
 const {collectorUrl,publicSiteKey,marketingAllowed,consentRecord,fetchImpl=(...args)=>globalThis.fetch(...args),currentUrl=()=>globalThis.location.href,cookieHeader=()=>globalThis.document.cookie,sessionStorage=globalThis.sessionStorage,randomUUID=()=>globalThis.crypto.randomUUID(),now=()=>Date.now()}=config??{};
 const endpoint=secureURL(collectorUrl);
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(publicSiteKey||''))throw new TypeError('Invalid public site key');
 if(typeof marketingAllowed!=='function'||typeof consentRecord!=='function')throw new TypeError('Consent check and actual consent record required');
 endpoint.searchParams.set('site_key',publicSiteKey); // preflight can resolve the registered site's origin.
 const key=`pulso:resume:${publicSiteKey}`;let current=null,pendingRevocation=null;let queue=Promise.resolve();
 const allowed=()=>marketingAllowed()===true;
 function load(){if(current&&current.expires_at>now())return current;current=null;try{const saved=JSON.parse(sessionStorage?.getItem(key)||'null');if(saved&&HANDOFF.test(saved.token)&&saved.expires_at>now())current=saved;else sessionStorage?.removeItem(key);}catch{/* storage can be blocked */}return current;}
 function clear(){current=null;try{sessionStorage?.removeItem(key);}catch{}}
 function pendingDeletion(){
  if(pendingRevocation)return pendingRevocation;
  try{const saved=JSON.parse(sessionStorage?.getItem(key+':revoke')||'null');if(saved&&HANDOFF.test(saved.token))pendingRevocation=saved;}catch{}
  return pendingRevocation;
 }
 async function revokeConsent(){
  // Necessary privacy-only processing: retain a pending deletion receipt until
  // acknowledged, so lost connectivity cannot silently re-enable server CAPI.
  const existing=pendingDeletion()||load();clear();if(!existing)return {sent:false,reason:'no_session'};
  pendingRevocation=existing;try{sessionStorage?.setItem(key+':revoke',JSON.stringify(existing));}catch{}
  try{
   const res=await fetchImpl(endpoint.href,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({site_key:publicSiteKey,action:'revoke',resume_token:existing.token}),keepalive:true});
   if(res.ok){pendingRevocation=null;try{sessionStorage?.removeItem(key+':revoke');}catch{}}
   return {sent:res.ok,reason:res.ok?'revoked':`http_${res.status}`,pending:!res.ok};
  }catch{return {sent:false,reason:'revocation_network_error',pending:true};}
 }
 async function send(eventName,eventId){
  if(pendingDeletion()){const revoked=await revokeConsent();if(!revoked.sent)return {sent:false,reason:'revocation_pending'};}
  if(!allowed()){if(current)await revokeConsent();return {sent:false,reason:'marketing_not_allowed'};}
  const consent=consentRecord();
  if(!consent||consent.marketing!==true||consent.basis!=='consent'||typeof consent.policy_version!=='string'||!Number.isFinite(Date.parse(consent.captured_at)))return {sent:false,reason:'consent_record_required'};
  const url=secureURL(currentUrl());const prior=load();
  const payload={site_key:publicSiteKey,event_id:eventId,event_name:eventName,page_url:url.origin+url.pathname,click:safeQuery(url),browser:{fbp:readCookie(cookieHeader()||'','_fbp'),fbc:readCookie(cookieHeader()||'','_fbc')},consent,...(prior?{resume_token:prior.token}:{})};
  let response;try{response=await fetchImpl(endpoint.href,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true});}catch{return {sent:false,reason:'network_error'};}
  if(!response.ok)return {sent:false,reason:`http_${response.status}`};
  const body=await response.json().catch(()=>({}));
  if(!allowed()){
   if(HANDOFF.test(body.resume_token||'')){current={token:body.resume_token,expires_at:Date.parse(body.expires_at)};await revokeConsent();}
   return {sent:false,reason:'marketing_revoked'};
  }
  const expiresAt=Date.parse(body.expires_at);
  if(HANDOFF.test(body.resume_token||'')&&Number.isFinite(expiresAt)&&expiresAt>now()){
   current={token:body.resume_token,expires_at:expiresAt};try{sessionStorage?.setItem(key,JSON.stringify(current));}catch{}
  }
  return {sent:true,event_id:eventId,duplicate:body.duplicate===true};
 }
 function track(eventName,options={}){
  if(!EVENTS.has(eventName))return Promise.reject(new TypeError('Unsupported event'));
  // checkout_started must be called ONLY by an actual checkout-open/load signal.
  const eventId=options.eventId||randomUUID();if(!UUID.test(eventId))return Promise.reject(new TypeError('Secure UUID required'));
  const result=queue.then(()=>send(eventName,eventId));queue=result.catch(()=>{});return result;
 }
 function checkoutHref(rawHref){const url=secureURL(rawHref);if(!allowed()||pendingDeletion()||url.hostname!=='pay.hotmart.com'||url.searchParams.has('sck'))return rawHref;const session=load();if(!session)return rawHref;url.searchParams.set('sck',session.token);return url.href;}
 return Object.freeze({track,checkoutHref,revokeConsent,reset:clear});
}
