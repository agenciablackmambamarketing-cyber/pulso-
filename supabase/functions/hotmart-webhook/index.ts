import "jsr:@supabase/functions-js@2.118.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { createHotmartHandler } from "../_shared/hotmart.mjs";
import { verifyHandoff, sha256 } from "../_shared/handoff.mjs";

Deno.serve(async (request: Request) => {
  let modernKeys: Record<string,string>;
  try { modernKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); }
  catch {return new Response('{"error":"Server not configured"}',{status:503,headers:{"Content-Type":"application/json"}});}
  const url=Deno.env.get("SUPABASE_URL");
  const key=modernKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url || !key)return new Response('{"error":"Server not configured"}',{status:503,headers:{"Content-Type":"application/json"}});
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  // Hottok authenticates the source in SQL. HMAC only authenticates the handoff;
  // SQL also checks tenant, registered token digest, expiry and current consent.
  // No webhook IP is ever used as a buyer IP. No payload, token or PII logging.
  const handle=createHotmartHandler({
    rpc:(name: string,params:Record<string,unknown>)=>client.rpc(name,params),
    verifyHandoff,sha256,handoffKey:Deno.env.get("PULSO_HANDOFF_HMAC_KEY"),
  });
  return await handle(request);
});
