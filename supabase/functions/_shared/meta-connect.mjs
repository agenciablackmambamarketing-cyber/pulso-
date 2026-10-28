import {validateDataset, verifyDataset, sealCredential, openCredential} from './meta.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function smallJSON(request, limit=16384) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('content_type');
  const reader = request.body?.getReader(); if (!reader) throw new Error('body_required');
  const chunks=[]; let length=0;
  for (;;) {const {done,value}=await reader.read(); if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error('too_large');}chunks.push(value);}
  const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  const parsed=JSON.parse(new TextDecoder().decode(data));
  if (!parsed || Array.isArray(parsed) || typeof parsed!=='object') throw new Error('bad_body');
  return parsed;
}
export async function handleMetaConnect(request, dependencies) {
  const {rpc,authUser,origins=[],credentialKey,version,fetchImpl=fetch}=dependencies;
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  if (!origin || !origins.includes(origin)) return json({error:'origin_denied'},403);
  Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if (!credentialKey || !version) return json({error:'server_not_configured'},503);
  const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if(!token)return json({error:'unauthorized'},401);
  let user;try {user=await authUser(token);}catch{return json({error:'unauthorized'},401);}
  if(!user?.id)return json({error:'unauthorized'},401);
  let input;try{input=await smallJSON(request);}catch(error){return json({error:'invalid_input'},error.message==='too_large'?413:400);}
  if(!UUID.test(input.workspace_id??'') || !['save','test','disable','revoke','reprocess'].includes(input.action))return json({error:'invalid_input'},400);
  if(Object.keys(input).some(key=>!['workspace_id','action','dataset_id','access_token','test_event_code','destination_ref','outbox_id'].includes(key)))return json({error:'invalid_input'},400);
  try {await rpc('pulso_meta_authorize',{p_workspace_id:input.workspace_id,p_user_id:user.id});}catch{return json({error:'forbidden'},403);}
  try {
    if(input.action==='save') {
      validateDataset(input.dataset_id);
      if(!/^[A-Za-z0-9_-]{3,128}$/.test(input.test_event_code??''))return json({error:'test_code_required'},400);
      const result=await verifyDataset(input.dataset_id,input.access_token,{fetchImpl,version});
      if(!result.ok)return json({error:'meta_verification_failed',http_status:result.http_status,meta_error_code:result.meta_error_code},422);
      const ciphertext=await sealCredential({access_token:input.access_token,dataset_id:input.dataset_id,mode:'test',test_event_code:input.test_event_code},input.workspace_id,input.dataset_id,credentialKey);
      const ref=await rpc('pulso_meta_save',{p_workspace_id:input.workspace_id,p_user_id:user.id,p_dataset_id:input.dataset_id,p_ciphertext:ciphertext,p_mode:'test'});
      return json({ok:true,destination_ref:ref,status:'connected',mode:'test'});
    }
    if(!UUID.test(input.destination_ref??''))return json({error:'destination_required'},400);
    if(input.action==='test') {
      const saved=await rpc('pulso_meta_credential',{p_workspace_id:input.workspace_id,p_destination_ref:input.destination_ref});
      if(!saved)return json({error:'credential_missing'},409);
      const credential=await openCredential(saved.ciphertext,input.workspace_id,saved.dataset_id,credentialKey);
      const result=await verifyDataset(saved.dataset_id,credential.access_token,{fetchImpl,version});
      return json(result.ok?{ok:true,status:'connected',mode:'test'}:{error:'meta_verification_failed',http_status:result.http_status,meta_error_code:result.meta_error_code},result.ok?200:422);
    }
    if(input.action==='reprocess' && !UUID.test(input.outbox_id??''))return json({error:'outbox_required'},400);
    const ok=await rpc('pulso_meta_control',{p_workspace_id:input.workspace_id,p_user_id:user.id,p_destination_ref:input.destination_ref,p_action:input.action,p_outbox_id:input.outbox_id??null});
    return json({ok:Boolean(ok)},ok?200:409);
  }catch{return json({error:'operation_failed'},400);}
}
