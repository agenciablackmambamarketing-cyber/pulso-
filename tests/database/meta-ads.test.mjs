import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isolatedDatabase,seedWorkspaces,asUser,asRole,ids} from './helpers.mjs';

const sealed=()=>JSON.stringify({v:1,iv:Buffer.alloc(12,1).toString('base64'),data:Buffer.alloc(32,2).toString('base64')});
const account=(overrides={})=>({id:'123456789',name:'Synthetic Meta account',currency:'BRL',timezone_name:'America/Sao_Paulo',account_status:1,...overrides});
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function fixture(){
  const sandbox=await isolatedDatabase();
  await seedWorkspaces(sandbox.db);
  const day=(await sandbox.db.query("select to_char((now() at time zone 'UTC')::date-1,'YYYY-MM-DD') as day")).rows[0].day;
  return {...sandbox,day};
}
async function save(db,workspace=ids.wa,user=ids.a,details=account()){
  return (await db.query('select public.pulso_ads_save($1,$2,$3,$4) as id',[workspace,user,details,sealed()])).rows[0].id;
}
async function begin(db,id,workspace=ids.wa,user=ids.a){
  return (await db.query('select public.pulso_ads_begin_sync($1,$2,$3) as lease',[workspace,user,id])).rows[0].lease;
}
function snapshot(day,details=account(),overrides={}){
  return {account:details,
    campaigns:[
      {id:'987654321',name:'Synthetic active',status:'ACTIVE',effective_status:'ACTIVE',objective:'OUTCOME_SALES'},
      {id:'987654322',name:'Synthetic paused',status:'PAUSED',effective_status:'PAUSED',objective:'OUTCOME_SALES'},
    ],
    daily:[
      {campaign_id:'987654321',date:day,spend:'12.00',impressions:120,clicks:12},
      {campaign_id:'987654322',date:day,spend:'8.00',impressions:80,clicks:8},
    ],account_daily:[{date:day,spend:'20.00'}],...overrides};
}
async function complete(db,id,lease,from,until,data,workspace=ids.wa){
  return (await db.query('select public.pulso_ads_complete_sync($1,$2,$3,$4,$5,$6) as result',[workspace,id,lease.lease_id,from,until,data])).rows[0].result;
}
async function sync(db,id,day,data=snapshot(day),workspace=ids.wa,user=ids.a){
  const lease=await begin(db,id,workspace,user);
  await complete(db,id,lease,day,day,data,workspace);
  return lease;
}
async function metrics(db,from,until=from,workspace=ids.wa,user=ids.a){
  return (await asUser(db,user,'select public.pulso_ads_metrics($1,$2,$3) as metrics',[workspace,from,until])).rows[0].metrics;
}
async function sale(db,day,currency,gross,status='APPROVED',net=0,verified=false,settlement=currency,workspace=ids.wa,provider='hotmart'){
  await db.query(`insert into public.sales(workspace_id,external_transaction_id,currency,gross_amount,status,purchased_at,
    net_amount,net_amount_verified,settlement_currency,provider,raw)
    values($1,$2,$3,$4,$5,($6::date+interval '12 hours') at time zone 'America/Sao_Paulo',$7,$8,$9,$10,'{"buyer":"DO_NOT_EXPOSE_BUYER"}')`,
    [workspace,'SYNTHETIC-'+randomUUID(),currency,gross,status,day,net,verified,settlement,provider]);
}

test('Meta Ads canonical account spend includes paused campaigns, replaces retries and ignores legacy metric rows',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const id=await save(db);
    const first=await sync(db,id,day);
    assert.equal(first.connection_id,id);
    assert.equal(first.external_account_id,'123456789');
    assert.equal(first.sealed_credential,sealed());
    let report=await metrics(db,day);
    assert.equal(report.version,1);
    assert.equal(report.accounts.length,1);
    assert.equal(report.accounts[0].complete,true);
    assert.equal(report.accounts[0].spend,20);
    assert.equal(report.campaigns.length,2);
    assert.equal(report.campaigns.find(c=>c.effective_status==='PAUSED').spend,8);
    assert.equal(report.financial.find(c=>c.currency==='BRL').media_spend,20);

    // Canonical provider totals must never be replaced by an unrelated legacy
    // metric cache, even if that cache contains a plausible currency amount.
    await db.query(`insert into public.daily_ad_metrics(workspace_id,ad_account_id,campaign_id,metric_date,spend)
      select a.workspace_id,a.id,c.id,$1,999999 from public.ad_accounts a
      join public.campaigns c on c.workspace_id=a.workspace_id and c.ad_account_id=a.id
      where a.workspace_id=$2 and a.external_account_id='123456789' and c.external_campaign_id='987654321'
      on conflict(workspace_id,ad_account_id,campaign_id,metric_date) do update set spend=999999`,[day,ids.wa]);
    await sync(db,id,day);
    report=await metrics(db,day);
    assert.equal(report.accounts[0].spend,20,'repeated full synchronization replaces rather than sums');
    assert.equal(report.campaigns.find(c=>c.effective_status==='ACTIVE').spend,12);
    assert.equal(report.financial.find(c=>c.currency==='BRL').media_spend,20);
    assert.ok(!JSON.stringify(report).includes(sealed()));
    assert.ok(!JSON.stringify(report).includes('sealed_credential'));
  }finally{await f.close();}
});

test('Meta Ads finance keeps currencies separate, excludes refunds and does not invent net profit',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const brl=await save(db);await sync(db,brl,day);
    const usdDetails=account({id:'223456789',currency:'USD',name:'Synthetic USD account'});
    const usd=await save(db,ids.wa,ids.a,usdDetails);
    await sync(db,usd,day,snapshot(day,usdDetails,{
      campaigns:[{id:'887654321',name:'USD campaign',status:'ACTIVE',effective_status:'ACTIVE',objective:'OUTCOME_SALES'}],
      daily:[{campaign_id:'887654321',date:day,spend:'5.50',impressions:50,clicks:5}],account_daily:[{date:day,spend:'5.50'}],
    }));
    await sale(db,day,'BRL',100,'APPROVED',85,true);
    await sale(db,day,'BRL',40,'REFUNDED',30,true);
    await sale(db,day,'BRL',60,'CHARGEBACK',50,true);
    await sale(db,day,'USD',50);
    await sale(db,day,'EUR',30);
    await sale(db,day,'CAD',10,'APPROVED',8,true,null);
    let report=await metrics(db,day);
    const b=report.financial.find(c=>c.currency==='BRL');
    const u=report.financial.find(c=>c.currency==='USD');
    const e=report.financial.find(c=>c.currency==='EUR');
    const unknownSettlement=report.financial.find(c=>c.currency==='CAD');
    assert.equal(b.approved_revenue,100);assert.equal(b.verified_net_revenue,85);
    assert.equal(b.refunded_orders,2);assert.equal(b.media_spend,20);assert.equal(b.revenue_after_media,80);assert.equal(b.media_roi_percent,400);
    assert.equal(u.approved_revenue,50);assert.equal(u.verified_net_revenue,null);
    assert.equal(u.media_spend,5.5);assert.equal(u.revenue_after_media,44.5);
    assert.equal(e.approved_revenue,30);assert.equal(e.media_spend,null);assert.equal(e.revenue_after_media,null);assert.equal(e.media_roi_percent,null);
    assert.equal(unknownSettlement.verified_net_revenue,null,'a verified amount with unknown settlement currency is not reconciled net revenue');
    for(const row of report.financial){assert.equal(row.profit,null);assert.equal(row.roi_percent,null);}
    assert.ok(!JSON.stringify(report).includes('DO_NOT_EXPOSE_BUYER'));
    await sale(db,day,'BRL',10,'APPROVED',8,false);
    report=await metrics(db,day);
    assert.equal(report.financial.find(c=>c.currency==='BRL').verified_net_revenue,null,'one unreconciled sale makes net revenue unknown');
  }finally{await f.close();}
});

test('Meta Ads distinguishes complete zero spend from missing days, failed refresh and disconnected accounts',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const id=await save(db);
    let report=await metrics(db,day);
    assert.equal(report.accounts[0].complete,false);assert.equal(report.accounts[0].spend,null);
    assert.equal(report.financial[0].media_roi_percent,null);
    await sync(db,id,day,snapshot(day,account(),{campaigns:[],daily:[],account_daily:[]}));
    report=await metrics(db,day);
    assert.equal(report.accounts[0].complete,true);assert.equal(report.accounts[0].spend,0);
    assert.equal(report.financial.find(c=>c.currency==='BRL').media_spend,0);
    assert.equal(report.financial[0].media_roi_percent,null,'zero investment has no finite ROI');
    report=await metrics(db,addDays(day,-1),day);
    assert.equal(report.accounts[0].complete,false);assert.equal(report.accounts[0].spend,null);
    assert.equal(report.financial[0].media_roi_percent,null);
    const lease=await begin(db,id);
    await db.query('select public.pulso_ads_fail_sync($1,$2,$3,$4)',[ids.wa,id,lease.lease_id,'meta_ads_auth']);
    report=await metrics(db,day);
    assert.equal(report.accounts[0].status,'error');assert.equal(report.accounts[0].spend,null);
    assert.equal(report.financial[0].media_roi_percent,null);
    await db.query('select public.pulso_ads_revoke($1,$2,$3)',[ids.wa,ids.a,id]);
    report=await metrics(db,day);
    assert.equal(report.accounts[0].status,'revoked');assert.equal(report.accounts[0].spend,null);
    assert.equal(report.financial[0].media_roi_percent,null);
    await assert.rejects(begin(db,id));
  }finally{await f.close();}
});

test('Media ROI includes every recorded sales provider with explicit Meta spend scope and signed returns',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const id=await save(db);await sync(db,id,day);
    let report=await metrics(db,day);
    assert.deepEqual(report.media_providers,['meta']);
    assert.equal(report.revenue_scope,'all_recorded_sales');
    assert.equal(report.financial[0].approved_revenue,0);
    assert.equal(report.financial[0].media_roi_percent,-100);
    await sale(db,day,'BRL',10);
    await sale(db,day,'BRL',10,'APPROVED',8,false,'BRL',ids.wa,'synthetic_other_platform');
    report=await metrics(db,day);
    assert.equal(report.financial[0].approved_revenue,20,'revenue cannot be filtered to Hotmart');
    assert.equal(report.financial[0].media_roi_percent,0);
    await sale(db,day,'BRL',5,'COMPLETE',4,true,'BRL',ids.wa,'synthetic_other_platform');
    await sale(db,day,'BRL',200,'PENDING',0,false,'BRL',ids.wa,'synthetic_other_platform');
    await sale(db,day,'BRL',500,'APPROVED',450,true,'BRL',ids.wb,'synthetic_other_platform');
    report=await metrics(db,day);
    assert.equal(report.financial[0].approved_revenue,25,'unapproved orders and other tenants stay excluded');
    assert.equal(report.financial[0].media_roi_percent,25);
    assert.equal(report.financial[0].roi_percent,null,'all-cost ROI stays unknown without costs');
    assert.equal(report.financial[0].profit,null);
  }finally{await f.close();}
});

test('Meta Ads and Meta CAPI retain independent integration identities regardless of connection order',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const firstAds=await save(db);
    const capi=(await db.query("select public.pulso_meta_save($1,$2,'123456789',$3,'test') as id",[ids.wa,ids.a,sealed()])).rows[0].id;
    const secondDetails=account({id:'223456789',name:'Second ad account'});
    const secondAds=await save(db,ids.wa,ids.a,secondDetails);
    await db.query("select public.pulso_meta_save($1,$2,'123456789',$3,'test')",[ids.wa,ids.a,sealed()]);
    const integrations=(await db.query(`select i.id,i.provider_user_id,i.status from public.integrations i
      where i.workspace_id=$1 and i.provider='meta' order by provider_user_id nulls first`,[ids.wa])).rows;
    assert.equal(integrations.length,3);
    const capiIntegration=integrations.find(row=>row.provider_user_id===null);
    assert.ok(capiIntegration);
    const destination=(await db.query('select integration_id from public.conversion_destinations where id=$1',[capi])).rows[0];
    assert.equal(destination.integration_id,capiIntegration.id);
    for(const id of [firstAds,secondAds]){
      const mapped=(await db.query('select a.integration_id from public.meta_ads_accounts m join public.ad_accounts a on a.id=m.ad_account_id where m.id=$1',[id])).rows[0];
      assert.notEqual(mapped.integration_id,capiIntegration.id);
      // Legacy ad-account metadata is mutable by a workspace administrator.
      // It cannot redirect a credential operation into the CAPI integration.
      await asUser(db,ids.a,`update public.ad_accounts set integration_id=$1
        where id=(select ad_account_id from public.meta_ads_accounts where id=$2)`,[capiIntegration.id,id]);
      // asUser rolls back its transaction, so persist the same hostile fixture
      // as the local test administrator to exercise the server-side predicate.
      await db.query('update public.ad_accounts set integration_id=$1 where id=(select ad_account_id from public.meta_ads_accounts where id=$2)',[capiIntegration.id,id]);
      await db.query('select public.pulso_ads_revoke($1,$2,$3)',[ids.wa,ids.a,id]);
    }
    assert.equal((await db.query('select status from public.integrations where id=$1',[capiIntegration.id])).rows[0].status,'connected');
    assert.ok((await db.query('select public.pulso_meta_credential($1,$2) as credential',[ids.wa,capi])).rows[0].credential);
    await save(db);await sync(db,firstAds,day);
    await db.query("select public.pulso_meta_control($1,$2,$3,'revoke')",[ids.wa,ids.a,capi]);
    assert.equal((await metrics(db,day)).accounts.find(a=>a.id===firstAds).status,'connected');
    assert.equal((await metrics(db,day)).accounts.find(a=>a.id===firstAds).spend,20);
  }finally{await f.close();}
});

test('Meta Ads leases reject concurrent/stale work, credential rotation and revoked writes',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const id=await save(db);const lease=await begin(db,id);
    await assert.rejects(begin(db,id));
    assert.equal(await save(db),id,'reconnecting same account retains its logical connection');
    await assert.rejects(complete(db,id,lease,day,day,snapshot(day)));
    const rotated=await begin(db,id);assert.notEqual(rotated.lease_id,lease.lease_id);
    await db.query('select public.pulso_ads_revoke($1,$2,$3)',[ids.wa,ids.a,id]);
    await assert.rejects(complete(db,id,rotated,day,day,snapshot(day)));
    const report=await metrics(db,day);
    assert.equal(report.accounts[0].status,'revoked');assert.equal(report.accounts[0].spend,null);
  }finally{await f.close();}
});

test('Meta Ads validates entire snapshots before changing an existing complete window',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const id=await save(db);await sync(db,id,day);
    const invalid=[];
    let value=snapshot(day);value.account.id='999999999';invalid.push(value);
    value=snapshot(day);value.account.currency='USD';invalid.push(value);
    value=snapshot(day);value.daily[0].spend='-1.00';invalid.push(value);
    value=snapshot(day);value.account_daily[0].spend='NaN';invalid.push(value);
    value=snapshot(day);value.daily[0].date=addDays(day,1);invalid.push(value);
    value=snapshot(day);value.daily[0].campaign_id='777777777';invalid.push(value);
    value=snapshot(day);value.daily.push({...value.daily[0]});invalid.push(value);
    value=snapshot(day);value.daily[0].spend='12.0000001';value.account_daily[0].spend='20.0000001';invalid.push(value);
    for(const data of invalid){
      const lease=await begin(db,id);
      await assert.rejects(complete(db,id,lease,day,day,data));
      // Fail the attempted sync to release its lease. The old financial cache
      // remains intact but must not be represented as a successful fresh pull.
      await db.query('select public.pulso_ads_fail_sync($1,$2,$3,$4)',[ids.wa,id,lease.lease_id,'meta_ads_invalid_payload']);
      await save(db);
      const report=await metrics(db,day);
      assert.ok(report.accounts[0].spend===null || report.accounts[0].spend===20);
      await sync(db,id,day);
      assert.equal((await metrics(db,day)).accounts[0].spend,20);
    }
  }finally{await f.close();}
});

test('Meta Ads retains provider micro-unit precision and accepts the smallest nonzero provider identifiers',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    await assert.rejects(save(db,ids.wa,ids.a,account({id:'0'})),error=>error.code==='22023');
    const details=account({id:'1',name:'Small identifier account'});
    const id=await save(db,ids.wa,ids.a,details);
    await sync(db,id,day,snapshot(day,details,{
      campaigns:[{id:'2',name:'Micro spend campaign',status:'ACTIVE',effective_status:'ACTIVE',objective:'OUTCOME_SALES'}],
      daily:[{campaign_id:'2',date:day,spend:'0.000001',impressions:1,clicks:0}],
      account_daily:[{date:day,spend:'0.000001'}],
    }));
    const report=await metrics(db,day);
    assert.equal(report.accounts[0].external_account_id,'1');
    assert.equal(report.accounts[0].spend,0.000001);
    assert.equal(report.campaigns[0].spend,0.000001);
    assert.equal(report.financial[0].media_spend,0.000001);
    assert.equal(report.financial[0].revenue_after_media,-0.000001);
    assert.equal(report.financial[0].profit,null);
  }finally{await f.close();}
});

test('Meta Ads respects account-local reporting dates and suppresses financial totals across timezone mismatches',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const timezone='Pacific/Kiritimati';
    const details=account({id:'423456789',name:'Ahead timezone account',timezone_name:timezone});
    const id=await save(db,ids.wa,ids.a,details);
    const empty=date=>snapshot(date,details,{campaigns:[],daily:[],account_daily:[]});
    await sync(db,id,day,empty(day));
    let report=await metrics(db,day);
    assert.equal(report.accounts[0].complete,true);assert.equal(report.accounts[0].spend,0);
    assert.equal(report.financial[0].complete,false);
    assert.equal(report.financial[0].coverage_reason,'timezone_mismatch');
    assert.equal(report.financial[0].media_spend,null);
    const localToday=(await db.query("select to_char(now() at time zone $1,'YYYY-MM-DD') as day",[timezone])).rows[0].day;
    await sync(db,id,localToday,empty(localToday));
    await db.query('update public.workspaces set timezone=$1 where id=$2',[timezone,ids.wa]);
    report=await metrics(db,localToday);
    assert.equal(report.accounts[0].complete,true,'freshness must use the account local day rather than UTC');
    assert.equal(report.financial[0].complete,true);assert.equal(report.financial[0].media_spend,0);
    await assert.rejects(metrics(db,addDays(localToday,1)),error=>error.code==='22023');
  }finally{await f.close();}
});

test('Meta Ads service credentials, canonical caches and actor claims stay inaccessible to browser roles',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const id=await save(db);await sync(db,id,day);
    for(const bad of [null,'{}',JSON.stringify({one:1,two:2,data:Buffer.alloc(32).toString('base64')}),JSON.stringify({v:null,iv:null,data:null}),JSON.stringify({v:'1',iv:Buffer.alloc(12).toString('base64'),data:Buffer.alloc(32).toString('base64')})]){
      await assert.rejects(db.query('select public.pulso_ads_save($1,$2,$3,$4)',[ids.wa,ids.a,account(),bad]),error=>error.code==='22023');
    }
    const other=await save(db,ids.wb,ids.b,account({id:'323456789',name:'Other tenant account'}));
    await assert.rejects(save(db,ids.wb,ids.a),error=>error.code==='42501');
    await assert.rejects(begin(db,id,ids.wa,ids.b),error=>error.code==='42501');
    await assert.rejects(begin(db,other,ids.wa,ids.a));
    for(const [query,values] of [
      ['select public.pulso_ads_save($1,$2,$3,$4)',[ids.wa,ids.a,account(),sealed()]],
      ['select public.pulso_ads_begin_sync($1,$2,$3)',[ids.wa,ids.a,id]],
      ['select public.pulso_ads_complete_sync($1,$2,$3,$4,$5,$6)',[ids.wa,id,randomUUID(),day,day,snapshot(day)]],
      ['select public.pulso_ads_fail_sync($1,$2,$3,$4)',[ids.wa,id,randomUUID(),'meta_ads_auth']],
      ['select public.pulso_ads_revoke($1,$2,$3)',[ids.wa,ids.a,id]],
    ]){
      await assert.rejects(asUser(db,ids.a,query,values),error=>error.code==='42501');
      await assert.rejects(asRole(db,'anon',query,values),error=>error.code==='42501');
    }
    await assert.rejects(asUser(db,ids.a,"update public.meta_ads_accounts set name='forged' where id=$1",[id]),error=>error.code==='42501');
    const tables=(await db.query("select tablename from pg_tables where schemaname='private' and tablename like 'meta_ads%'" )).rows;
    assert.ok(tables.length>0);
    for(const {tablename} of tables){
      assert.match(tablename,/^[a-z_]+$/);
      await assert.rejects(asUser(db,ids.a,`select * from private.${tablename}`),error=>error.code==='42501');
    }
    const visible=await asUser(db,ids.a,'select id from public.meta_ads_accounts');
    assert.deepEqual(visible.rows.map(r=>r.id),[id]);
  }finally{await f.close();}
});

test('Meta Ads reporting enforces current tenant membership, viewer access and bounded date windows',async()=>{
  const f=await fixture();const {db,day}=f;
  try{
    const id=await save(db);await sync(db,id,day);
    const query='select public.pulso_ads_metrics($1,$2,$3)';
    await assert.rejects(asUser(db,ids.a,query,[ids.wb,day,day]),error=>error.code==='42501');
    await assert.rejects(asRole(db,'anon',query,[ids.wa,day,day]),error=>error.code==='42501');
    const viewer=randomUUID();await db.query('insert into auth.users(id) values($1)',[viewer]);
    await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",[ids.wa,viewer]);
    assert.equal((await metrics(db,day,day,ids.wa,viewer)).accounts[0].spend,20);
    await db.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2',[ids.wa,viewer]);
    await assert.rejects(metrics(db,day,day,ids.wa,viewer),error=>error.code==='42501');
    for(const [from,until] of [[null,day],[day,null],[addDays(day,1),day],[addDays(day,-31),day],[day,addDays(day,2)],[addDays(day,-367),addDays(day,-366)]]){
      await assert.rejects(asUser(db,ids.a,query,[ids.wa,from,until]),error=>error.code==='22023');
    }
    const wrapper=(await db.query("select prosecdef from pg_proc where oid='public.pulso_ads_metrics(uuid,date,date)'::regprocedure")).rows[0];
    assert.equal(wrapper.prosecdef,false);
  }finally{await f.close();}
});
