import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {handleMetaConnect} from "../_shared/meta-connect.mjs";
function envKey(modern:string,legacy:string){try{return JSON.parse(Deno.env.get(modern)||"{}").default||Deno.env.get(legacy);}catch{return undefined;}}
Deno.serve(async(request:Request)=>{
 const url=Deno.env.get('SUPABASE_URL');
 const pub=envKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
 const secret=envKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!pub||!secret)return new Response(JSON.stringify({error:'server_not_configured'}),{status:503,headers:{'Content-Type':'application/json'}});
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const auth=createClient(url,pub,options),admin=createClient(url,secret,options);
 return handleMetaConnect(request,{
  origins:(Deno.env.get('PULSO_ADMIN_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean),
  credentialKey:Deno.env.get('PULSO_META_CREDENTIAL_KEY_V1'),version:Deno.env.get('META_GRAPH_VERSION'),
  authUser:async(token:string)=>{const {data,error}=await auth.auth.getUser(token);if(error)throw error;return data.user;},
  rpc:async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('database_operation');return data;},
 });
});
