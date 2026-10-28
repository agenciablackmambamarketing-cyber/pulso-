import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info"};
const json = (value: unknown, status=200) => new Response(JSON.stringify(value), {status,headers:{"Content-Type":"application/json",...cors}});
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  const token=req.headers.get("Authorization")?.replace(/^Bearer /i,"");
  if(!token) return json({error:"Unauthorized"},401);
  let input: {workspace_id?:string;hottok?:string;label?:string};
  try {input=await req.json();} catch {return json({error:"Malformed JSON"},400);}
  if(!input?.workspace_id || !input?.hottok || input.hottok.length < 12) return json({error:"Invalid input"},400);
  const url=Deno.env.get("SUPABASE_URL")!;
  const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}")["default"] || Deno.env.get("SUPABASE_ANON_KEY");
  const secret=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")["default"] || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url || !pub || !secret) return json({error:"Server not configured"},503);
  const sessionClient=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await sessionClient.auth.getUser(token);
  if(authError || !user) return json({error:"Unauthorized"},401);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await admin.rpc("register_hotmart_source",{
    p_workspace_id:input.workspace_id,p_user_id:user.id,p_label:input.label || "Hotmart",p_hottok:input.hottok
  });
  if(error) return json({error:/denied/i.test(error.message)?"Forbidden":"Could not connect"},/denied/i.test(error.message)?403:400);
  return json({ok:true,source_id:data,webhook_url:`${url}/functions/v1/hotmart-webhook`});
});