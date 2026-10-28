import "jsr:@supabase/functions-js@2.118.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import {createHotmartConnectHandler,hotmartConnectConfig} from "../_shared/hotmart-connect.mjs";

Deno.serve(async(request:Request)=>{
  const config=hotmartConnectConfig((name:string)=>Deno.env.get(name));
  if(!config)return new Response(JSON.stringify({error:'server_not_configured'}),{
    status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'},
  });
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(config.url,config.publishableKey,options);
  const admin=createClient(config.url,config.secretKey,options);
  return createHotmartConnectHandler({
    origins:config.origins,webhookUrl:`${config.url}/functions/v1/hotmart-webhook`,
    authUser:async(token:string)=>{const {data,error}=await auth.auth.getUser(token);if(error)throw new Error('unauthorized');return data.user;},
    rpc:(name:string,args:Record<string,unknown>)=>admin.rpc(name,args),
  })(request);
});
