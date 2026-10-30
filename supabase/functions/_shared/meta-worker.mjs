import {secretMatches,openCredential,sendPurchase} from './meta.mjs';
export async function handleMetaWorker(request, dependencies) {
  const {rpc,workerSecret,credentialKey,version,fetchImpl=fetch}=dependencies;
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!await secretMatches(workerSecret,request.headers.get('x-pulso-worker-secret')))return json({error:'unauthorized'},401);
  if(!credentialKey || !version)return json({error:'server_not_configured'},503);
  let rows;try{rows=await rpc('pulso_meta_claim',{p_limit:1});}catch{return json({error:'queue_unavailable'},503);}
  let accepted=0,failed=0,skipped=0;
  for(const row of rows??[]) {
    let result;
    try {
      const credential=await openCredential(row.ciphertext,row.workspace_id,row.dataset_id,credentialKey);
      // This first release deliberately handles test events only. No environment flag can silently enable production.
      if(row.test_mode!==true || credential.mode!=='test')throw new Error('production_disabled');
      const valid=await rpc('pulso_meta_lease_valid',{p_id:row.id,p_lease_token:row.lease_token});
      if(!valid){skipped++;continue;}
      result=await sendPurchase(row,credential,{fetchImpl,version,allowProduction:false});
    }catch{
      result={accepted:false,retryable:false,http_status:0,meta_error_code:null,error_code:'configuration_invalid',response_id:null};
    }
    try {
      const recorded=await rpc('pulso_meta_finish',{p_id:row.id,p_lease_token:row.lease_token,p_accepted:result.accepted,p_retryable:result.retryable,p_http_status:result.http_status,p_meta_error_code:result.meta_error_code,p_error_code:result.error_code,p_response_id:result.response_id});
      if(!recorded)skipped++;else if(result.accepted)accepted++;else failed++;
    }catch{skipped++;} // Lease expiry recovers after crashes; stable event_id prevents logical duplicate.
  }
  return json({ok:true,claimed:rows?.length??0,accepted,failed,skipped});
}
