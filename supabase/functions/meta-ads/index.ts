import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {handleMetaAds} from "../_shared/meta-ads.mjs";
import {loadRuntimeConfig,supabaseRuntimeKey} from "../_shared/runtime-config.mjs";
Deno.serve(async(request:Request)=>{
 try{
  const getEnv=(name:string)=>Deno.env.get(name),url=getEnv('SUPABASE_URL');if(!url)throw new Error('configuration');
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,supabaseRuntimeKey(getEnv,'secret'),options),auth=createClient(url,supabaseRuntimeKey(getEnv,'publishable'),options);
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('database_operation');return data;};
  // Same narrowly scoped origins/AES key/Graph version as Meta credential setup;
  // ads tokens have a separate AAD domain and independent workspace credential.
  const config=await loadRuntimeConfig('meta_connect',{getEnv,rpc});
  return handleMetaAds(request,{origins:config.PULSO_ADMIN_ORIGINS.split(',').map((x:string)=>x.trim()),credentialKey:config.PULSO_META_CREDENTIAL_KEY_V1,version:config.META_GRAPH_VERSION,authUser:async(token:string)=>{const {data,error}=await auth.auth.getUser(token);if(error)throw new Error('unauthorized');return data.user;},rpc});
 }catch{return new Response('{"error":"server_not_configured"}',{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
});
