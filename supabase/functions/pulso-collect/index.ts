import "jsr:@supabase/functions-js@2.118.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { createCollector } from "../_shared/collector.mjs";
const secret=()=>JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
Deno.serve(async(req:Request)=>{
 try {
  const url=Deno.env.get('SUPABASE_URL'),key=secret(),handoffKey=Deno.env.get('PULSO_HANDOFF_HMAC_KEY');
  if(!url||!key||!handoffKey||handoffKey.length<32)return new Response(JSON.stringify({error:'collector_unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  return await createCollector({handoffKey,ipHashKey:Deno.env.get('PULSO_RATE_HASH_KEY'),trustedIPHeader:Deno.env.get('PULSO_TRUSTED_IP_HEADER')||'',rpc:async(name:string,args:Record<string,unknown>)=>{const {data,error}=await client.rpc(name,args);if(error)throw new Error(error.message);return data;}})(req);
 }catch{return new Response(JSON.stringify({error:'collector_unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});}
});
