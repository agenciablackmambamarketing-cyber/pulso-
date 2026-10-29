/** Server-only Marketing API reads. No advertising mutation or CAPI endpoint.
 * Caller commits a complete result atomically; partial/paged responses are errors.
 */
import {graphVersion} from './meta.mjs';

const DAY=86_400_000;
const MAX_PAGES=20;
const MAX_BYTES=2_000_000;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
export class MetaAdsAPIError extends Error {
  constructor(code,{retryable=false,httpStatus=null,metaErrorCode=null}={}){
    super(code);this.name='MetaAdsAPIError';this.code=code;
    this.retryable=retryable;this.httpStatus=httpStatus;this.metaErrorCode=metaErrorCode;
  }
}
function fail(code='meta_ads_invalid_response',options){throw new MetaAdsAPIError(code,options);}

/** IDs remain strings; converting Meta IDs to Number silently loses precision. */
export function validateAdAccountId(value){
  if(typeof value!=='string' || !/^(?:act_)?[0-9]{1,32}$/.test(value))fail('invalid_ad_account');
  const id=value.replace(/^act_/,'').replace(/^0+(?=\d)/,'');
  if(id==='0')fail('invalid_ad_account');
  return id;
}
function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const stamp=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value?stamp:null;
}
export function validateDateWindow(value,now=Date.now(),timeZone){
  if(!object(value)||Object.keys(value).some(key=>!['since','until'].includes(key)))fail('invalid_date_window');
  const since=date(value.since),until=date(value.until),time=typeof now==='function'?now():now;
  if(since===null||until===null||!Number.isFinite(time)||Math.abs(time)>8.64e15||since>until||until-since>30*DAY)fail('invalid_date_window');
  // Before resolving an account, tomorrow UTC may already be today in UTC+14.
  // The transport revalidates against the actual account calendar before insights.
  let latest=Math.floor(time/DAY)*DAY+DAY;
  if(timeZone!==undefined){
    try{
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
      const part=type=>parts.find(item=>item.type===type)?.value;
      latest=date(`${part('year')}-${part('month')}-${part('day')}`);
    }catch{fail('invalid_date_window');}
  }
  if(latest===null||until>latest)fail('invalid_date_window');
  return {since:value.since,until:value.until};
}
function identifier(value){
  try{return validateAdAccountId(value);}catch{fail();}
}
function label(value,token,{nullable=false,max=500}={}){
  if(nullable && (value===null||value===undefined))return null;
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||value.includes(token))fail();
  return value;
}
function enumLabel(value,token,{nullable=false}={}){
  if(nullable && (value===null||value===undefined))return null;
  const result=label(value,token,{max:80});
  if(!/^[A-Z][A-Z0-9_]*$/.test(result))fail();
  return result;
}
function integer(value){
  if(typeof value==='string' && /^\d{1,16}$/.test(value))value=Number(value);
  if(!Number.isSafeInteger(value)||value<0)fail();
  return value;
}
function money(value){
  // Meta returns decimal strings in account currency. Never round via floating point.
  if(typeof value!=='string'||!/^\d{1,16}(?:\.\d{1,6})?$/.test(value))fail();
  let [whole,fraction='']=value.split('.');
  whole=whole.replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
  if(whole.length>12)fail();
  return whole+(fraction?'.'+fraction:'');
}
function safeProviderError(status,body){
  const code=Number.isInteger(body?.error?.code)?body.error.code:null;
  const retryable=status===429||status>=500||body?.error?.is_transient===true;
  return new MetaAdsAPIError(code===190?'meta_ads_auth':([10,200,294,299].includes(code)||status===403)?'meta_ads_permission':retryable?'meta_ads_transient':'meta_ads_rejected',{
    retryable,httpStatus:status,metaErrorCode:code,
  });
}
async function readJSON(response){
  const stated=response.headers?.get('content-length');
  if(stated!==null && stated!==undefined && (!/^\d+$/.test(stated)||Number(stated)>MAX_BYTES))fail();
  const reader=response.body?.getReader();
  if(!reader)fail();
  const chunks=[];let bytes=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();fail();}chunks.push(value);}
  }finally{reader.releaseLock();}
  const data=new Uint8Array(bytes);let offset=0;
  for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  let body;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{fail();}
  if(!object(body))fail();
  return body;
}

/** Complete account/campaign snapshot plus authoritative account-level daily spend.
 * Missing zero-activity days are intentionally not fabricated here. The caller may
 * fill them only after receiving this complete, successful bounded result.
 */
export async function readMetaAds(input,{fetchImpl=fetch,version,now=Date.now()}={}){
  if(!object(input))fail('invalid_ad_account');
  const accountId=validateAdAccountId(input.accountId);
  const reportNow=typeof now==='function'?now():now;
  const window=validateDateWindow({since:input.since,until:input.until},reportNow);
  const token=input.accessToken;
  if(typeof token!=='string'||token.length<20||token.length>8192||/[\s\u0000-\u001f\u007f]/.test(token))fail('invalid_access_token');
  let apiVersion;try{apiVersion=graphVersion(version);}catch{fail('meta_ads_configuration');}
  if(typeof fetchImpl!=='function')fail('meta_ads_configuration');
  const base=`https://graph.facebook.com/${apiVersion}/act_${accountId}`;
  async function request(path,params){
    const url=new URL(base+path);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    let response,body;
    try{
      response=await fetchImpl(url.href,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10_000)});
      body=await readJSON(response);
    }catch(error){
      // Meta/CDN rate-limit and outage responses are not always JSON. Keep the
      // HTTP retry classification without retaining or exposing their raw body.
      if(response&&(response.status===429||response.status>=500))throw safeProviderError(response.status,null);
      if(error instanceof MetaAdsAPIError)throw error;
      fail('meta_ads_network',{retryable:true});
    }
    if(!Number.isInteger(response.status)||response.status<200||response.status>=300||body.error)throw safeProviderError(response.status,body);
    return body;
  }
  async function collection(path,params){
    const rows=[],seenCursors=new Set();let after=null;
    for(let page=0;page<MAX_PAGES;page++){
      const body=await request(path,{...params,limit:'100',...(after?{after}:{})});
      if(!Array.isArray(body.data)||body.data.length>100||body.data.some(row=>!object(row)))fail();
      rows.push(...body.data);
      if(body.paging!==undefined && !object(body.paging))fail();
      const paging=body.paging;
      if(paging?.cursors!==undefined && !object(paging.cursors))fail();
      if(!paging || !own(paging,'next'))return rows;
      // Presence signals another page; the returned URL itself is NEVER followed.
      const cursor=paging.cursors?.after;
      if(typeof paging.next!=='string'||!paging.next||typeof cursor!=='string'||!cursor||cursor.length>4096||cursor.includes(token)||/[\u0000-\u001f\u007f]/.test(cursor)||seenCursors.has(cursor))fail('meta_ads_pagination_invalid');
      seenCursors.add(cursor);after=cursor;
    }
    fail('meta_ads_pagination_limit');
  }
  const rawAccount=await request('',{fields:'id,account_id,name,currency,timezone_name,account_status'});
  if(identifier(rawAccount.account_id)!==accountId || (rawAccount.id!==undefined && identifier(rawAccount.id)!==accountId))fail('meta_ads_account_mismatch');
  if(typeof rawAccount.currency!=='string'||!/^[A-Z]{3}$/.test(rawAccount.currency))fail();
  const timezone=label(rawAccount.timezone_name,token,{max:100});
  try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{fail();}
  validateDateWindow(window,reportNow,timezone);
  const account={id:accountId,name:label(rawAccount.name,token),currency:rawAccount.currency,timezone_name:timezone,account_status:integer(rawAccount.account_status)};
  const shared={time_range:JSON.stringify(window),time_increment:'1'};
  const [campaignRows,dailyRows,accountRows]=await Promise.all([
    collection('/campaigns',{fields:'id,name,status,effective_status,objective'}),
    collection('/insights',{...shared,level:'campaign',fields:'account_id,account_currency,campaign_id,campaign_name,spend,impressions,clicks,date_start,date_stop'}),
    collection('/insights',{...shared,level:'account',fields:'account_id,account_currency,spend,date_start,date_stop'}),
  ]);
  const campaigns=new Map();
  for(const row of campaignRows){
    const id=identifier(row.id);if(campaigns.has(id))fail();
    campaigns.set(id,{id,name:label(row.name,token),status:enumLabel(row.status,token),effective_status:enumLabel(row.effective_status,token),objective:enumLabel(row.objective,token,{nullable:true})});
  }
  function common(row){
    if(identifier(row.account_id)!==accountId)fail('meta_ads_account_mismatch');
    if(row.account_currency!==account.currency)fail('meta_ads_currency_mismatch');
    const stamp=date(row.date_start);
    if(stamp===null||row.date_start!==row.date_stop||row.date_start<window.since||row.date_start>window.until)fail();
    return {date:row.date_start,spend:money(row.spend)};
  }
  const daily=[],seenDaily=new Set();
  for(const row of dailyRows){
    const value=common(row),campaign_id=identifier(row.campaign_id),key=campaign_id+':'+value.date;
    if(seenDaily.has(key))fail();seenDaily.add(key);
    if(!campaigns.has(campaign_id))campaigns.set(campaign_id,{id:campaign_id,name:label(row.campaign_name,token),status:'UNKNOWN',effective_status:'UNKNOWN',objective:null});
    daily.push({campaign_id,...value,impressions:integer(row.impressions),clicks:integer(row.clicks)});
  }
  const account_daily=[],seenDates=new Set();
  for(const row of accountRows){
    const value=common(row);if(seenDates.has(value.date))fail();seenDates.add(value.date);account_daily.push(value);
  }
  return {account,campaigns:[...campaigns.values()].sort((a,b)=>a.id.localeCompare(b.id)),daily:daily.sort((a,b)=>a.date.localeCompare(b.date)||a.campaign_id.localeCompare(b.campaign_id)),account_daily:account_daily.sort((a,b)=>a.date.localeCompare(b.date))};
}
