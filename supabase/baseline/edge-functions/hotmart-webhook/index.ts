import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST") return json({error:"Method not allowed"},405);
 const hottok=req.headers.get("x-hotmart-hottok");
 if(!hottok||hottok.length<12) return json({error:"Unauthorized"},401);
 const len=Number(req.headers.get("content-length")||"0");
 if(len>128000) return json({error:"Payload too large"},413);
 let event:Record<string,unknown>;
 try {
  const raw=await req.text();
  if(raw.length>128000) return json({error:"Payload too large"},413);
  event=JSON.parse(raw);
  if(!event||Array.isArray(event)||typeof event!=="object") throw Error("Invalid JSON");
 } catch {return json({error:"Malformed JSON"},400);}
 const url=Deno.env.get("SUPABASE_URL");
 const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const secrets=Deno.env.get("SUPABASE_SECRET_KEYS");
 const modern=secrets?JSON.parse(secrets)["default"]:undefined;
 const key=modern||legacy;
 if(!url||!key) return json({error:"Server not configured"},503);
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.rpc("ingest_hotmart_event",{p_hottok:hottok,p_payload:event});
 if(error) {
  const bad=/Invalid Hotmart event|Invalid event timestamp|Invalid money amount/.test(error.message);
  const denied=/Unauthorized Hotmart source/.test(error.message);
  console.error("hotmart-ingest",{code:error.code,kind:bad?"bad_input":denied?"denied":"database"});
  return json({error:bad?"Invalid event":denied?"Unauthorized":"Ingestion failed"},bad?400:denied?401:503);
 }
 return json(data??{ok:true});
});
