import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {createCollector} from "../_shared/collector.mjs";
import {loadRuntimeConfig,supabaseRuntimeKey,collectorDatabaseError} from "../_shared/runtime-config.mjs";
Deno.serve(async(request:Request)=>{
 try{
  const getEnv=(name:string)=>Deno.env.get(name),url=getEnv('SUPABASE_URL');
  if(!url)throw new Error('configuration');
  const admin=createClient(url,supabaseRuntimeKey(getEnv,'secret'),{auth:{persistSession:false,autoRefreshToken:false}});
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw collectorDatabaseError(error);return data;};
  const config=await loadRuntimeConfig('collector',{getEnv,rpc});
  return createCollector({handoffKey:config.PULSO_HANDOFF_HMAC_KEY,ipHashKey:config.PULSO_RATE_HASH_KEY,trustedIPHeader:getEnv('PULSO_TRUSTED_IP_HEADER')||'',rpc})(request);
 }catch{return new Response('{"error":"collector_unavailable"}',{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
});
