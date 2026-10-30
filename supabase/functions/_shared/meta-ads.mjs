/** Owner/admin-only Marketing API connection. Credentials never leave the backend. */
import {readMetaAds,validateAdAccountId,validateDateWindow,MetaAdsAPIError} from './meta-ads-api.mjs';
import {sealCredential,openCredential} from './meta.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=value=>typeof value==='string'&&UUID.test(value);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const SAFE_ERRORS=new Set(['meta_ads_auth','meta_ads_permission','meta_ads_transient','meta_ads_rejected','meta_ads_network','meta_ads_invalid_response','meta_ads_account_mismatch','meta_ads_currency_mismatch','meta_ads_pagination_invalid','meta_ads_pagination_limit','meta_ads_configuration','invalid_ad_account','invalid_access_token','invalid_date_window']);
async function inputJSON(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw Error('invalid_input');
 const reader=request.body?.getReader();if(!reader)throw Error('invalid_input');
 const chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384){await reader.cancel();throw Error('payload_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!object(input))throw Error('invalid_input');return input;
}
export async function handleMetaAds(request,dependencies){
 const {rpc,authUser,origins=[],credentialKey,version,read=readMetaAds,now=Date.now}=dependencies??{};
 const origin=request.headers.get('origin');
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const json=(value,status=200)=>new Response(value===null?null:JSON.stringify(value),{status,headers});
 if(!origin||!origins.includes(origin))return json({error:'origin_denied'},403);
 Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'});
 if(request.method==='OPTIONS')return json(null,204);
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 const bearer=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
 if(!bearer||bearer.length>8192)return json({error:'unauthorized'},401);
 if(!credentialKey||!version||typeof rpc!=='function'||typeof authUser!=='function')return json({error:'server_not_configured'},503);
 let user;try{user=await authUser(bearer);}catch{return json({error:'unauthorized'},401);}
 if(!uuid(user?.id))return json({error:'unauthorized'},401);
 let input;
 try{
  input=await inputJSON(request);
  if(!uuid(input.workspace_id)||!['save','sync','revoke'].includes(input.action))throw Error('invalid_input');
  const keys=input.action==='save'?['workspace_id','action','account_id','access_token']:input.action==='sync'?['workspace_id','action','connection_id','since','until']:['workspace_id','action','connection_id'];
  if(Object.keys(input).some(k=>!keys.includes(k)))throw Error('invalid_input');
  if(input.action!=='save'&&!uuid(input.connection_id))throw Error('invalid_input');
 }catch(error){return json({error:'invalid_input'},error.message==='payload_too_large'?413:400);}
 // No Graph call or credential read until a verified user's actual role is checked.
 try{if(await rpc('pulso_meta_authorize',{p_workspace_id:input.workspace_id,p_user_id:user.id})!==true)throw Error('forbidden');}catch{return json({error:'forbidden'},403);}
 let lease=null;
 try{
  if(input.action==='save'){
   const accountId=validateAdAccountId(input.account_id);
   if(typeof input.access_token!=='string'||input.access_token.length<20||input.access_token.length>8192||/[\s\u0000-\u001f\u007f]/.test(input.access_token))return json({error:'invalid_access_token'},400);
   // Yesterday UTC is not in the future for any account timezone. Reading its
   // insights verifies actual ads-read permission without sending conversions.
   const date=new Date(now()-86400000).toISOString().slice(0,10);
   const snapshot=await read({accountId,accessToken:input.access_token,since:date,until:date},{version,now:now()});
   const binding='meta_ads:'+accountId;
   const sealed=await sealCredential({dataset_id:binding,access_token:input.access_token},input.workspace_id,binding,credentialKey);
   input.access_token='';
   const id=await rpc('pulso_ads_save',{p_workspace_id:input.workspace_id,p_user_id:user.id,p_account:snapshot.account,p_sealed_credential:sealed});
   if(!uuid(id))throw Error('database_operation');
   return json({ok:true,connection_id:id,status:'connected',synced:false});
  }
  if(input.action==='revoke'){
   await rpc('pulso_ads_revoke',{p_workspace_id:input.workspace_id,p_user_id:user.id,p_connection_id:input.connection_id});
   return json({ok:true,status:'revoked'});
  }
  const window=validateDateWindow({since:input.since,until:input.until},now());
  lease=await rpc('pulso_ads_begin_sync',{p_workspace_id:input.workspace_id,p_user_id:user.id,p_connection_id:input.connection_id});
  if(!object(lease)||lease.connection_id!==input.connection_id||!uuid(lease.lease_id))throw Error('database_operation');
  const accountId=validateAdAccountId(lease.external_account_id),binding='meta_ads:'+accountId;
  const credential=await openCredential(lease.sealed_credential,input.workspace_id,binding,credentialKey);
  const snapshot=await read({accountId,accessToken:credential.access_token,...window},{version,now:now()});
  const saved=await rpc('pulso_ads_complete_sync',{p_workspace_id:input.workspace_id,p_connection_id:input.connection_id,p_lease_id:lease.lease_id,p_since:window.since,p_until:window.until,p_snapshot:snapshot});
  if(!saved?.ok)throw Error('database_operation');
  return json({ok:true,status:'connected',synced:true});
 }catch(error){
  const code=error instanceof MetaAdsAPIError&&SAFE_ERRORS.has(error.code)?error.code:'meta_ads_sync_failed';
  if(lease?.lease_id){try{await rpc('pulso_ads_fail_sync',{p_workspace_id:input.workspace_id,p_connection_id:input.connection_id,p_lease_id:lease.lease_id,p_error_code:code});}catch{/* A rotated/stale lease cannot alter the new connection. */}}
  return json({error:code},code.startsWith('invalid_')?400:error instanceof MetaAdsAPIError&&!error.retryable?422:503);
 }finally{if(input?.access_token)input.access_token='';}
}
