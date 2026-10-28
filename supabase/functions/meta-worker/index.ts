import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {handleMetaWorker} from "../_shared/meta-worker.mjs";
import {loadRuntimeConfig,supabaseRuntimeKey} from "../_shared/runtime-config.mjs";
Deno.serve(async(request:Request)=>{
 if(!request.headers.get('x-pulso-worker-secret'))return new Response('{"error":"unauthorized"}',{status:401,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 try{
  const getEnv=(name:string)=>Deno.env.get(name),url=getEnv('SUPABASE_URL');if(!url)throw new Error('configuration');
  const admin=createClient(url,supabaseRuntimeKey(getEnv,'secret'),{auth:{persistSession:false,autoRefreshToken:false}});
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('database_operation');return data;};
  const config=await loadRuntimeConfig('meta_worker',{getEnv,rpc});
  return handleMetaWorker(request,{workerSecret:config.PULSO_META_WORKER_SECRET,credentialKey:config.PULSO_META_CREDENTIAL_KEY_V1,version:config.META_GRAPH_VERSION,rpc});
 }catch{return new Response('{"error":"server_not_configured"}',{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
});
