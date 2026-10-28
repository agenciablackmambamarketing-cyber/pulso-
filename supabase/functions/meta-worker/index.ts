import "jsr:@supabase/functions-js@2.118.0/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {handleMetaWorker} from "../_shared/meta-worker.mjs";
Deno.serve(async(request:Request)=>{
 let secret;try{secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');}catch{}
 const url=Deno.env.get('SUPABASE_URL');
 if(!url||!secret)return new Response(JSON.stringify({error:'server_not_configured'}),{status:503,headers:{'Content-Type':'application/json'}});
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 return handleMetaWorker(request,{
  workerSecret:Deno.env.get('PULSO_META_WORKER_SECRET'),credentialKey:Deno.env.get('PULSO_META_CREDENTIAL_KEY_V1'),version:Deno.env.get('META_GRAPH_VERSION'),
  rpc:async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('database_operation');return data;},
 });
});
