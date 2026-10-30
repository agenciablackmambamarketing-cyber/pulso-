import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {createHotmartConnectHandler,hotmartConnectConfig} from "../_shared/hotmart-connect.mjs";
import {loadRuntimeConfig,supabaseRuntimeKey} from "../_shared/runtime-config.mjs";
Deno.serve(async(request:Request)=>{
 try{
  const getEnv=(name:string)=>Deno.env.get(name),url=getEnv('SUPABASE_URL');if(!url)throw new Error('configuration');
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,supabaseRuntimeKey(getEnv,'secret'),options);
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('database_operation');return data;};
  const settings=await loadRuntimeConfig('hotmart_connect',{getEnv,rpc});
  const config=hotmartConnectConfig((name:string)=>Object.hasOwn(settings,name)?settings[name]:getEnv(name));if(!config)throw new Error('configuration');
  const auth=createClient(config.url,config.publishableKey,options);
  return createHotmartConnectHandler({origins:config.origins,webhookUrl:`${config.url}/functions/v1/hotmart-webhook`,authUser:async(token:string)=>{const {data,error}=await auth.auth.getUser(token);if(error)throw new Error('unauthorized');return data.user;},rpc:(name:string,args:Record<string,unknown>)=>admin.rpc(name,args)})(request);
 }catch{return new Response('{"error":"server_not_configured"}',{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'}});}
});
