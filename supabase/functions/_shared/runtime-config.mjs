/** Backend-only settings loader. Values never belong in a response or log.
 * Vault is read through a service-role-only allowlisted RPC; it is not a browser API.
 */
const COMPONENTS=Object.freeze({
 collector:['PULSO_HANDOFF_HMAC_KEY','PULSO_RATE_HASH_KEY'],
 webhook:['PULSO_HANDOFF_HMAC_KEY'],
 hotmart_connect:['PULSO_DASHBOARD_ORIGINS'],
 meta_connect:['PULSO_ADMIN_ORIGINS','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION'],
 meta_worker:['PULSO_META_WORKER_SECRET','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION'],
});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const unavailable=()=>new Error('runtime_configuration_unavailable');
export function runtimeSettingNames(component){
 if(!Object.hasOwn(COMPONENTS,component))throw unavailable();
 return [...COMPONENTS[component]];
}
function valid(name,value){
 if(typeof value!=='string'||!value||value.length>8192)return false;
 if(name.endsWith('_ORIGINS'))return value.split(',').every(raw=>{const s=raw.trim();try{const u=new URL(s);return u.protocol==='https:'&&u.origin===s&&!u.username&&!u.password;}catch{return false;}});
 if(name==='META_GRAPH_VERSION')return /^v[2-9][0-9]\.0$/.test(value);
 if(name==='PULSO_META_CREDENTIAL_KEY_V1'){try{return /^[A-Za-z0-9+/]+={0,2}$/.test(value)&&atob(value).length===32;}catch{return false;}}
 return value.length>=32&&!/[\s\u0000-\u001f\u007f]/.test(value);
}
export async function loadRuntimeConfig(component,{getEnv,rpc}){
 const names=runtimeSettingNames(component);
 const env=Object.fromEntries(names.map(name=>[name,getEnv(name)]));
 const present=names.filter(name=>env[name]!==undefined&&env[name]!==null);
 let values;
 if(present.length){
  // Never combine keys from different stores; partial source configuration is a deployment error.
  if(present.length!==names.length)throw unavailable();
  values=env;
 }else{
  try{values=await rpc('pulso_runtime_config',{p_component:component});}catch{throw unavailable();}
 }
 if(!object(values)||Object.keys(values).length!==names.length||Object.keys(values).some(name=>!names.includes(name))||names.some(name=>!valid(name,values[name])))throw unavailable();
 return Object.freeze(Object.fromEntries(names.map(name=>[name,values[name]])));
}
/** Built-in Supabase identity only. A malformed modern map must not fall back. */
export function supabaseRuntimeKey(getEnv,kind){
 if(!['publishable','secret'].includes(kind))throw unavailable();
 const [modern,legacy]=kind==='secret'?['SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY']:['SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'];
 try{const raw=getEnv(modern);let keys={};if(raw!==undefined&&raw!==null){keys=JSON.parse(raw);if(!object(keys))throw unavailable();}const key=keys.default??getEnv(legacy);if(typeof key!=='string'||!key)throw unavailable();return key;}catch{throw unavailable();}
}
/** Only these exact SQL labels are public collector protocol errors. Never
 * forward database details, hints, substrings, constraint names or raw payloads.
 */
export function collectorDatabaseError(error){
 const allowed=new Set(['rate_limit','invalid_resume','consent_required','origin_denied']);
 return new Error(allowed.has(error?.message)?error.message:'database_operation');
}
/** Safe financial webhook protocol classifications, stripped of provider details. */
export function hotmartDatabaseError(error){
 const allowed=new Set(['Unauthorized Hotmart source','Invalid Hotmart event','Invalid event timestamp','Invalid event status','Invalid money amount','Invalid product','Transaction facts changed']);
 return new Error(allowed.has(error?.message)?error.message:'database_operation');
}
