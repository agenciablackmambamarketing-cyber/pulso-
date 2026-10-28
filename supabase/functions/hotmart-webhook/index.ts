import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {createHotmartHandler} from "../_shared/hotmart.mjs";
import {verifyHandoff,sha256} from "../_shared/handoff.mjs";
import {loadRuntimeConfig,supabaseRuntimeKey,hotmartDatabaseError} from "../_shared/runtime-config.mjs";
Deno.serve(async(request:Request)=>{
 const json=(body:unknown,status:number)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const hottok=request.headers.get('x-hotmart-hottok');if(!hottok||hottok.length<12||hottok.length>512)return json({error:'Unauthorized'},401);
 try{
  const getEnv=(name:string)=>Deno.env.get(name),url=getEnv('SUPABASE_URL');if(!url)throw new Error('configuration');
  const admin=createClient(url,supabaseRuntimeKey(getEnv,'secret'),{auth:{persistSession:false,autoRefreshToken:false}});
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('database_operation');return data;};
  const config=await loadRuntimeConfig('webhook',{getEnv,rpc});
  // Buyer IP never comes from the webhook. Preserve ingestion error categorization in the handler.
  return createHotmartHandler({rpc:async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);return {data,error:error?hotmartDatabaseError(error):null};},verifyHandoff,sha256,handoffKey:config.PULSO_HANDOFF_HMAC_KEY})(request);
 }catch{return json({error:'Server not configured'},503);}
});
