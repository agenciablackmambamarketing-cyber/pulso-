/** Hotmart source registration. Secrets are write-only and never logged/echoed. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES=16_384;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
function invalid(code,status=400){const error=new Error(code);error.status=status;throw error;}
function exactOrigin(value){
  try {const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && url.origin===value;}
  catch {return false;}
}
export function hotmartConnectConfig(getEnv){
  // A malformed modern key map is a configuration failure, not a reason to
  // silently use a different identity/key. Only server-side names are read.
  try {
    const key=(modern,legacy)=>{
      const raw=getEnv(modern);let parsed={};
      if(raw){parsed=JSON.parse(raw);if(!object(parsed))throw new Error('bad_key_map');}
      const value=parsed.default??getEnv(legacy);
      if(typeof value!=='string'||!value.trim())throw new Error('missing_key');
      return value;
    };
    const rawUrl=getEnv('SUPABASE_URL');const url=new URL(rawUrl);
    if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) return null;
    const origins=(getEnv('PULSO_DASHBOARD_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean);
    if(!origins.length || origins.some(x=>!exactOrigin(x)))return null;
    return {url:url.origin,publishableKey:key('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),secretKey:key('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),origins:[...new Set(origins)]};
  }catch{return null;}
}
export async function readHotmartConnectBody(request,maxBytes=MAX_BYTES){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))invalid('content_type',415);
  const stated=request.headers.get('content-length');
  if(stated!==null && (!/^\d+$/.test(stated) || !Number.isSafeInteger(Number(stated))))invalid('invalid_input');
  if(stated!==null && Number(stated)>maxBytes)invalid('payload_too_large',413);
  const reader=request.body?.getReader();if(!reader)invalid('invalid_input');
  let bytes=0;const chunks=[];
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();invalid('payload_too_large',413);}chunks.push(value);}
  }finally{reader.releaseLock();}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  try {const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));if(!object(value))invalid('invalid_input');return value;}
  catch {invalid('invalid_input');}
}
export function validateHotmartConnectInput(input){
  if(!object(input) || Object.keys(input).some(key=>!['workspace_id','hottok','label'].includes(key)))invalid('invalid_input');
  if(typeof input.workspace_id!=='string'||!UUID.test(input.workspace_id))invalid('invalid_input');
  if(typeof input.hottok!=='string'||input.hottok.length<12||input.hottok.length>512||/[\u0000-\u0020\u007f]/.test(input.hottok))invalid('invalid_input');
  if(input.label!==undefined && (typeof input.label!=='string'||!input.label.trim()||input.label.length>100||/[\u0000-\u001f\u007f]/.test(input.label)))invalid('invalid_input');
  return {workspace_id:input.workspace_id,hottok:input.hottok,label:input.label?.trim()||'Hotmart'};
}
/** rpc returns Supabase {data,error}; authUser must use verified getUser(token). */
export function createHotmartConnectHandler({authUser,rpc,origins=/** @type {string[]} */ ([]),webhookUrl,configured=true}){
  const allowed=new Set(origins.filter(exactOrigin));
  return async request=>{
    const origin=request.headers.get('origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    const json=(body,status=200)=>new Response(body===null?null:JSON.stringify(body),{status,headers});
    if(!origin||!allowed.has(origin))return json({error:'origin_denied'},403);
    Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Max-Age':'600'});
    if(request.method==='OPTIONS')return json(null,204);
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if(!token||token.length>8192)return json({error:'unauthorized'},401);
    if(!configured||typeof authUser!=='function'||typeof rpc!=='function'||!webhookUrl)return json({error:'server_not_configured'},503);
    let user;
    try {user=await authUser(token);}catch{return json({error:'unauthorized'},401);}
    if(!user || typeof user.id!=='string'||!UUID.test(user.id))return json({error:'unauthorized'},401);
    let input;
    try {input=validateHotmartConnectInput(await readHotmartConnectBody(request));}
    catch(error){return json({error:error.status===413?'payload_too_large':error.status===415?'content_type':'invalid_input'},error.status||400);}
    try {
      // The caller cannot supply p_user_id. SQL independently checks owner/admin
      // membership and denies assigning a Hottok already owned by another tenant.
      const {data,error}=await rpc('register_hotmart_source',{p_workspace_id:input.workspace_id,p_user_id:user.id,p_label:input.label,p_hottok:input.hottok});
      if(error){
        const denied=/denied|assigned to another workspace/i.test(error.message||'');
        return json({error:denied?'forbidden':'registration_unavailable'},denied?403:503);
      }
      if(typeof data!=='string'||!UUID.test(data))return json({error:'registration_unavailable'},503);
      return json({ok:true,source_id:data,webhook_url:webhookUrl});
    }catch{return json({error:'registration_unavailable'},503);}
  };
}
