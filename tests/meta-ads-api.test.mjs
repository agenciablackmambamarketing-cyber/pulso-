import test from 'node:test';
import assert from 'node:assert/strict';
import {readMetaAds,validateAdAccountId,validateDateWindow,MetaAdsAPIError} from '../supabase/functions/_shared/meta-ads-api.mjs';

const token='SYNTHETIC-ADS-TOKEN-DO-NOT-ECHO';
const now=Date.parse('2026-10-29T12:00:00Z');
const input=()=>({accountId:'act_1234567890123456789',accessToken:token,since:'2026-10-01',until:'2026-10-29'});
const accountId='1234567890123456789';
const account=()=>({id:'act_'+accountId,account_id:accountId,name:'Synthetic account',currency:'BRL',timezone_name:'America/Sao_Paulo',account_status:1});
const campaign=(id='111')=>({id,name:'Synthetic '+id,status:'ACTIVE',effective_status:'ACTIVE',objective:'OUTCOME_SALES'});
const insight=(changes={})=>({account_id:accountId,account_currency:'BRL',campaign_id:'111',campaign_name:'Synthetic 111',date_start:'2026-10-28',date_stop:'2026-10-28',spend:'10.500000',impressions:'140',clicks:'3',...changes});
const accountInsight=(changes={})=>({account_id:accountId,account_currency:'BRL',date_start:'2026-10-28',date_stop:'2026-10-28',spend:'15.50',...changes});
const response=body=>Response.json(body);
function mock({accountData=account(),campaignData=[campaign()],dailyData=[insight()],accountDailyData=[accountInsight()],override}={}){
  const calls=[];
  const fetchImpl=async(raw,options)=>{
    const url=new URL(raw);calls.push({url,options});
    assert.equal(url.origin,'https://graph.facebook.com');assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.redirect,'error');
    assert.ok(options.signal instanceof AbortSignal);assert.equal(options.body,undefined);
    assert.ok(!raw.includes(token),'token must not appear in URL');
    if(override){const value=await override(url,options,calls);if(value)return value;}
    if(url.pathname==='/v26.0/act_'+accountId)return response(accountData);
    if(url.pathname==='/v26.0/act_'+accountId+'/campaigns')return response({data:campaignData});
    if(url.pathname==='/v26.0/act_'+accountId+'/insights'){
      assert.equal(url.searchParams.get('time_increment'),'1');
      assert.deepEqual(JSON.parse(url.searchParams.get('time_range')),{since:'2026-10-01',until:'2026-10-29'});
      assert.ok(url.searchParams.get('fields').includes('account_id'));
      assert.ok(url.searchParams.get('fields').includes('account_currency'));
      return response({data:url.searchParams.get('level')==='account'?accountDailyData:dailyData});
    }
    assert.fail('unexpected endpoint');
  };
  return {calls,fetchImpl};
}
const read=(mocked,changes={})=>readMetaAds({...input(),...changes},{now,version:'v26.0',fetchImpl:mocked.fetchImpl});
const errorCode=code=>error=>error instanceof MetaAdsAPIError && error.code===code && !JSON.stringify(error).includes(token) && !error.message.includes(token);

test('Meta ad account IDs stay exact strings and reporting windows use bounded account-calendar dates',()=>{
  assert.equal(validateAdAccountId('act_0001234567890123456789'),accountId);
  assert.equal(validateAdAccountId(accountId),accountId);
  for(const value of [0,123,undefined,'0','act_','https://graph.facebook.com/act_123','123/insights','act_1?fields=id','act_12\n'])assert.throws(()=>validateAdAccountId(value),/invalid_ad_account/);
  assert.deepEqual(validateDateWindow({since:'2026-09-29',until:'2026-10-29'},now),{since:'2026-09-29',until:'2026-10-29'});
  for(const value of [null,{since:'2026-09-28',until:'2026-10-29'},{since:'2026-02-30',until:'2026-03-01'},{since:'2026-10-29',until:'2026-10-31'},{since:'2026-10-29',until:'2026-10-28'},{since:'2026-10-1',until:'2026-10-29'},{since:'2026-10-01',until:'2026-10-29',extra:true}])assert.throws(()=>validateDateWindow(value,now),/invalid_date_window/);
  assert.throws(()=>validateDateWindow({since:'2026-10-30',until:'2026-10-30'},now,'UTC'),/invalid_date_window/);
});

test('future days are checked in the Meta account timezone before any insights request',async()=>{
  const earlyUTC=Date.parse('2026-10-29T02:00:00Z');
  const brazil=mock();
  await assert.rejects(readMetaAds(input(),{now:earlyUTC,version:'v26.0',fetchImpl:brazil.fetchImpl}),errorCode('invalid_date_window'));
  assert.equal(brazil.calls.length,1);
  const tokyo=mock({accountData:{...account(),timezone_name:'Asia/Tokyo'}});
  const value=await readMetaAds(input(),{now:earlyUTC,version:'v26.0',fetchImpl:tokyo.fetchImpl});
  assert.equal(value.account.timezone_name,'Asia/Tokyo');
  const lateUTC=Date.parse('2026-10-29T23:30:00Z'),window={since:'2026-10-30',until:'2026-10-30'};
  assert.deepEqual(validateDateWindow(window,lateUTC,'Asia/Tokyo'),window);
  assert.throws(()=>validateDateWindow(window,lateUTC,'America/Sao_Paulo'),/invalid_date_window/);
  let requests=0;
  const tomorrowTokyo=await readMetaAds({...input(),...window},{now:lateUTC,version:'v26.0',fetchImpl:async(raw)=>{
    requests++;const url=new URL(raw);
    if(!url.pathname.endsWith('/campaigns')&&!url.pathname.endsWith('/insights'))return response({...account(),timezone_name:'Asia/Tokyo'});
    if(url.pathname.endsWith('/insights'))assert.deepEqual(JSON.parse(url.searchParams.get('time_range')),window);
    return response({data:[]});
  }});
  assert.equal(tomorrowTokyo.account_daily.length,0);assert.equal(requests,4);
});

test('read-only snapshot preserves actual active status and authoritative spend including paused campaigns',async()=>{
  const m=mock({campaignData:[campaign(),{...campaign('222'),status:'PAUSED',effective_status:'PAUSED'}],dailyData:[insight(),insight({campaign_id:'222',campaign_name:'Paused',spend:'5.00',clicks:'1'})]});
  const value=await read(m);
  assert.deepEqual(value.account,{id:accountId,name:'Synthetic account',currency:'BRL',timezone_name:'America/Sao_Paulo',account_status:1});
  assert.equal(value.campaigns[0].effective_status,'ACTIVE');assert.equal(value.campaigns[1].effective_status,'PAUSED');
  assert.deepEqual(value.daily.map(row=>row.spend),['10.5','5']);
  assert.deepEqual(value.account_daily,[{date:'2026-10-28',spend:'15.5'}]);
  assert.equal(value.daily[0].impressions,140);assert.equal(m.calls.length,4);
  assert.ok(m.calls.every(call=>!call.url.pathname.endsWith('/events')));
  assert.ok(!JSON.stringify(value).includes(token));
});

test('pagination uses opaque cursors on rebuilt Graph URLs and never follows next URLs or their tokens',async()=>{
  const m=mock({override:url=>{
    if(url.pathname.endsWith('/campaigns'))return url.searchParams.has('after')?response({data:[campaign('222')]}):response({data:[campaign()],paging:{next:'https://credential-stealer.invalid/?access_token='+token,cursors:{after:'opaque/with+=symbols'}}});
  }});
  const value=await read(m);assert.equal(value.campaigns.length,2);
  const second=m.calls.filter(call=>call.url.pathname.endsWith('/campaigns'))[1];
  assert.equal(second.url.searchParams.get('after'),'opaque/with+=symbols');
  assert.ok(m.calls.every(call=>call.url.origin==='https://graph.facebook.com'));
});

test('campaigns removed from the current list retain observed spend and a safe unknown status',async()=>{
  const m=mock({campaignData:[],dailyData:[insight({campaign_id:'333',campaign_name:'Archived campaign',spend:'0.001000'})]});
  const value=await read(m);
  assert.deepEqual(value.campaigns,[{id:'333',name:'Archived campaign',status:'UNKNOWN',effective_status:'UNKNOWN',objective:null}]);
  assert.equal(value.daily[0].spend,'0.001');
});

test('a complete empty result remains empty so only a successful caller may fill zero-activity dates',async()=>{
  const m=mock({campaignData:[],dailyData:[],accountDailyData:[]});
  assert.deepEqual(await read(m),{account:{id:accountId,name:'Synthetic account',currency:'BRL',timezone_name:'America/Sao_Paulo',account_status:1},campaigns:[],daily:[],account_daily:[]});
});

test('Graph authentication, permission and transient failures expose only fixed codes',async()=>{
  for(const [status,code,expected,retryable] of [[400,190,'meta_ads_auth',false],[400,200,'meta_ads_permission',false],[403,10,'meta_ads_permission',false],[429,4,'meta_ads_transient',true],[503,2,'meta_ads_transient',true]]){
    const m=mock({override:()=>new Response(JSON.stringify({error:{code,message:token,error_data:{private:token}}}),{status})});
    await assert.rejects(read(m),error=>errorCode(expected)(error)&&error.retryable===retryable&&error.metaErrorCode===code);
    assert.equal(m.calls.length,1);
  }
  const m=mock({override:()=>{throw new Error('private connection details '+token);}});
  await assert.rejects(read(m),errorCode('meta_ads_network'));
});

test('non-JSON rate limits and outages remain retryable, including failures after an earlier page',async()=>{
  for(const status of [429,502,503]){
    const m=mock({override:()=>new Response('<html>Private upstream '+token+'</html>',{status})});
    await assert.rejects(read(m),error=>errorCode('meta_ads_transient')(error)&&error.retryable&&error.httpStatus===status);
  }
  const m=mock({override:url=>{
    if(!url.pathname.endsWith('/campaigns'))return;
    if(url.searchParams.has('after'))return new Response('Upstream details '+token,{status:503});
    return response({data:[campaign()],paging:{next:'ignored',cursors:{after:'second-page'}}});
  }});
  await assert.rejects(read(m),error=>errorCode('meta_ads_transient')(error)&&error.retryable);
  assert.equal(m.calls.filter(call=>call.url.pathname.endsWith('/campaigns')).length,2);
});

test('mismatched accounts or currencies, invalid dates, unsafe counters and decimal values fail atomically',async()=>{
  await assert.rejects(read(mock({accountData:{...account(),account_id:'999'}})),errorCode('meta_ads_account_mismatch'));
  await assert.rejects(read(mock({accountData:{...account(),currency:'bad'}})),errorCode('meta_ads_invalid_response'));
  await assert.rejects(read(mock({accountData:{...account(),timezone_name:'Not/A_Timezone'}})),errorCode('meta_ads_invalid_response'));
  for(const changes of [{account_id:'999'},{account_currency:'USD'},{date_stop:'2026-10-29'},{date_start:'2026-09-30',date_stop:'2026-09-30'},{impressions:'9007199254740992'},{clicks:'-1'}])await assert.rejects(read(mock({dailyData:[insight(changes)]})),error=>error instanceof MetaAdsAPIError);
  for(const spend of ['-1','1e2','NaN','1,20',1.25,'9999999999999','0.0000001'])await assert.rejects(read(mock({dailyData:[insight({spend})]})),errorCode('meta_ads_invalid_response'));
  await assert.rejects(read(mock({accountDailyData:[accountInsight({account_id:'999'})]})),errorCode('meta_ads_account_mismatch'));
  await assert.rejects(read(mock({campaignData:[{...campaign(),name:token}]})),errorCode('meta_ads_invalid_response'));
});

test('duplicate rows, malformed paging, repeated cursors and page limits reject partial snapshots',async()=>{
  for(const m of [mock({campaignData:[campaign(),campaign()]}),mock({dailyData:[insight(),insight()]}),mock({accountDailyData:[accountInsight(),accountInsight()]})])await assert.rejects(read(m),errorCode('meta_ads_invalid_response'));
  for(const paging of [{next:'https://graph.facebook.com/next'},{next:'next',cursors:{after:''}},{next:'next',cursors:{after:token}},{next:null,cursors:{after:'abc'}}]){
    await assert.rejects(read(mock({override:url=>url.pathname.endsWith('/campaigns')?response({data:[],paging}):null})),errorCode('meta_ads_pagination_invalid'));
  }
  const repeated=mock({override:url=>url.pathname.endsWith('/campaigns')?response({data:[],paging:{next:'next',cursors:{after:'same'}}}):null});
  await assert.rejects(read(repeated),errorCode('meta_ads_pagination_invalid'));
  assert.equal(repeated.calls.filter(call=>call.url.pathname.endsWith('/campaigns')).length,2);
  let cursor=0;const limit=mock({override:url=>url.pathname.endsWith('/campaigns')?response({data:[],paging:{next:'next',cursors:{after:String(++cursor)}}}):null});
  await assert.rejects(read(limit),errorCode('meta_ads_pagination_limit'));
  assert.equal(limit.calls.filter(call=>call.url.pathname.endsWith('/campaigns')).length,20);
});

test('credentials, invalid configuration, malformed JSON and oversized responses fail without leaking input',async()=>{
  let sent=0;const fetchImpl=async()=>{sent++;return response(account());};
  await assert.rejects(readMetaAds({...input(),accessToken:'short'},{version:'v26.0',now,fetchImpl}),errorCode('invalid_access_token'));
  await assert.rejects(readMetaAds(input(),{version:'unversioned',now,fetchImpl}),errorCode('meta_ads_configuration'));
  assert.equal(sent,0);
  for(const body of ['not JSON',JSON.stringify([account()]),JSON.stringify({private:'x'.repeat(2_000_000)})])await assert.rejects(readMetaAds(input(),{version:'v26.0',now,fetchImpl:async()=>new Response(body)}),errorCode('meta_ads_invalid_response'));
});
