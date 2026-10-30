import test from 'node:test';
import assert from 'node:assert/strict';
import {adsForCurrency,mediaRoi,roiPresentation,renderAds,validateAdsMetrics} from '../dashboard/ads.mjs';
import {currencyAmount} from '../dashboard/metrics.mjs';

const accountId='11111111-1111-4111-8111-111111111111';
const campaignId='22222222-2222-4222-8222-222222222222';
const clone=value=>structuredClone(value);
function fixture(){
  return {version:1,from:'2026-10-01',until:'2026-10-29',accounts:[{
    id:accountId,external_account_id:'123456789',name:'Conta da agência',currency:'BRL',timezone_name:'America/Sao_Paulo',status:'connected',last_sync_at:'2026-10-29T10:00:00Z',last_error_code:null,complete:true,spend:50,
  }],campaigns:[{
    id:campaignId,name:'Campanha ativa',status:'ACTIVE',effective_status:'ACTIVE',currency:'BRL',spend:30,account_name:'Conta da agência',account_id:accountId,
  },{
    id:'33333333-3333-4333-8333-333333333333',name:'Campanha pausada',status:'PAUSED',effective_status:'PAUSED',currency:'BRL',spend:20,account_name:'Conta da agência',account_id:accountId,
  }],financial:[{currency:'BRL',approved_revenue:100,verified_net_revenue:null,refunded_orders:1,media_spend:50,revenue_after_media:50,profit:null,complete:true}]};
}

test('Meta active campaign display uses actual effective status and total media keeps paused spend',()=>{
  const metrics=fixture();
  metrics.campaigns.push({id:'44444444-4444-4444-8444-444444444444',name:'Ativa sem gasto',status:'ACTIVE',effective_status:'ACTIVE',currency:'BRL',spend:0,account_name:'Conta da agência',account_id:accountId});
  const html=renderAds(metrics,{canSync:true});
  assert.match(html,/Campanha ativa/);
  assert.match(html,/Ativa sem gasto/);
  assert.doesNotMatch(html,/Campanha pausada/);
  assert.match(html,/2 campanha\(s\) com status ativo/);
  assert.ok(html.includes(currencyAmount(50,'BRL')));
  assert.ok(html.includes(currencyAmount(30,'BRL')));
  assert.match(html,/inclui campanhas pausadas/);
  assert.equal(adsForCurrency(metrics,'BRL').media_spend,50);
});

test('currency rows are separate and missing currency is unknown rather than fabricated zero',()=>{
  const metrics=fixture();
  metrics.accounts.push({...clone(metrics.accounts[0]),id:'55555555-5555-4555-8555-555555555555',external_account_id:'987654321',name:'Conta USD',currency:'USD',spend:10});
  metrics.financial.push({currency:'USD',approved_revenue:5,verified_net_revenue:null,refunded_orders:0,media_spend:10,revenue_after_media:-5,profit:null,complete:true});
  assert.equal(adsForCurrency(metrics,'BRL').media_spend,50);
  assert.equal(adsForCurrency(metrics,'USD').media_spend,10);
  assert.equal(adsForCurrency(metrics,'USD').revenue_after_media,-5);
  assert.equal(adsForCurrency(metrics,'EUR').media_spend,null);
  assert.equal(adsForCurrency(metrics,'EUR').approved_revenue,null);
  const html=renderAds(metrics);
  assert.match(html,/Resultado em BRL/);assert.match(html,/Resultado em USD/);
  const selected=renderAds(metrics,{currency:'USD'});
  assert.match(selected,/Resultado em USD/);assert.doesNotMatch(selected,/Resultado em BRL/);
  assert.match(selected,/Conta USD/);assert.doesNotMatch(selected,/Conta da agência/);
});

test('incomplete snapshots keep cached spend and result unavailable even if old numeric values exist',()=>{
  const metrics=fixture();metrics.accounts[0].complete=false;metrics.accounts[0].status='error';metrics.accounts[0].last_error_code='meta_ads_auth';metrics.financial[0].complete=false;
  const view=adsForCurrency(metrics,'BRL');
  assert.equal(view.media_spend,null);assert.equal(view.revenue_after_media,null);assert.equal(view.profit,null);
  const html=renderAds(metrics);
  assert.match(html,/Cobertura incompleta/);assert.match(html,/Acesso expirado/);
  assert.ok(!html.includes(currencyAmount(50,'BRL')));
  assert.ok(!html.includes(currencyAmount(30,'BRL')));
  assert.ok(html.includes(currencyAmount(100,'BRL')));
  assert.match(html,/O período ainda não foi totalmente sincronizado/);
});

test('confirmed zero spend is displayed and gross result is never labelled net profit',()=>{
  const metrics=fixture();metrics.accounts[0].spend=0;metrics.campaigns=[];metrics.financial[0].media_spend=0;metrics.financial[0].revenue_after_media=100;
  const html=renderAds(metrics);
  assert.ok(html.includes(currencyAmount(0,'BRL')));
  assert.ok(html.includes(currencyAmount(100,'BRL')));
  assert.match(html,/Receita aprovada após mídia/);
  assert.match(html,/Lucro líquido<\/dt><dd>—/);
  assert.match(html,/taxas, reembolsos e outros custos/);
});

test('mismatched timezones withhold combined result without hiding known account spend',()=>{
  const metrics=fixture();metrics.financial[0].complete=false;metrics.financial[0].coverage_reason='timezone_mismatch';
  const html=renderAds(metrics);
  assert.match(html,/O fuso da conta de anúncios difere do workspace/);
  assert.match(html,/Alinhe os fusos e o período/);
  assert.equal(adsForCurrency(metrics,'BRL').media_spend,null);
  assert.equal(adsForCurrency(metrics,'BRL').revenue_after_media,null);
  assert.ok(html.includes(currencyAmount(50,'BRL')),'Complete account snapshot still has its own spend');
});

test('provider names are escaped and unknown errors never reflect provider content or prototype members',()=>{
  const attack='<img src=x onerror="alert(1)">';
  const metrics=fixture();metrics.accounts[0].name=attack;metrics.accounts[0].timezone_name=attack;metrics.accounts[0].last_error_code='constructor';metrics.campaigns[0].name=attack;metrics.campaigns[0].account_name=attack;
  const html=renderAds(metrics,{canSync:true});
  assert.doesNotMatch(html,/<img|onerror="|function Object/);
  assert.match(html,/&lt;img/);
  assert.match(html,/Não foi possível concluir a sincronização/);
  const invalid=fixture();invalid.accounts[0].last_error_code=attack;
  assert.doesNotMatch(renderAds(invalid),/<img|onerror|alert\(/);
});

test('invalid dates, money, account relationships and unverified profit fail closed',()=>{
  const invalid=[];
  for(const value of [-1,'50',Number.NaN,Infinity]){const metric=fixture();metric.financial[0].media_spend=value;invalid.push(metric);}
  for(const [key,value] of [['from','2026-02-30'],['until','invalid'],['from','2026-11-01']]){const metric=fixture();metric[key]=value;invalid.push(metric);}
  const mismatch=fixture();mismatch.campaigns[0].currency='USD';invalid.push(mismatch);
  const missingAccount=fixture();missingAccount.campaigns[0].account_id='77777777-7777-4777-8777-777777777777';invalid.push(missingAccount);
  const duplicate=fixture();duplicate.accounts.push(clone(duplicate.accounts[0]));invalid.push(duplicate);
  const fakeProfit=fixture();fakeProfit.financial[0].profit=30;invalid.push(fakeProfit);
  const fakeResult=fixture();fakeResult.financial[0].revenue_after_media=60;invalid.push(fakeResult);
  const unknownCoverage=fixture();unknownCoverage.accounts[0].last_sync_at=null;invalid.push(unknownCoverage);
  for(const metrics of invalid){
    assert.throws(()=>validateAdsMetrics(metrics),/incompatíveis/);
    assert.match(renderAds(metrics),/Dados de anúncios indisponíveis/);
  }
});

test('no connected account and failed response do not appear as zero investment',()=>{
  const html=renderAds({version:1,from:'2026-10-01',until:'2026-10-29',accounts:[],campaigns:[],financial:[]});
  assert.match(html,/Nenhuma conta de anúncios conectada/);
  assert.doesNotMatch(html,/R\$|Lucro líquido/);
  for(const value of [null,{},undefined])assert.match(renderAds(value),/Nenhum gasto ou resultado foi substituído por zero/);
});

test('an account awaiting first synchronization does not pretend to have zero active campaigns',()=>{
  const metrics=fixture();metrics.accounts[0].complete=false;metrics.accounts[0].spend=null;metrics.accounts[0].last_sync_at=null;metrics.campaigns=[];metrics.financial[0].complete=false;
  const html=renderAds(metrics);
  assert.match(html,/Aguardando sincronização das contas para listar campanhas ativas/);
  assert.match(html,/a lista pode estar incompleta/);
  assert.doesNotMatch(html,/0 campanha\(s\)/);
});

test('sync and revoke actions are restricted by supplied admin capability and connection status',()=>{
  const metrics=fixture();
  for(const action of ['ads-sync','ads-revoke']){
    assert.match(renderAds(metrics),new RegExp('data-action="'+action+'"[^>]*disabled'));
    assert.doesNotMatch(renderAds(metrics,{canSync:true}),new RegExp('data-action="'+action+'"[^>]*disabled'));
    const revoked=clone(metrics);revoked.accounts[0].status='revoked';
    assert.match(renderAds(revoked,{canSync:true}),new RegExp('data-action="'+action+'"[^>]*disabled'));
  }
});

test('media ROI uses all approved revenue and known media cost with explicit positive negative and neutral results',()=>{
  const row=fixture().financial[0];
  assert.equal(mediaRoi(row),100);
  assert.equal(mediaRoi({...row,approved_revenue:0}),-100);
  assert.equal(mediaRoi({...row,approved_revenue:50}),0);
  assert.equal(mediaRoi({...row,approved_revenue:25}),-50);
  assert.equal(roiPresentation(100).text,'+100,00%');
  assert.equal(roiPresentation(100).className,'roi-positive');
  assert.match(roiPresentation(100).label,/positivo/);
  assert.equal(roiPresentation(-50).text,'-50,00%');
  assert.equal(roiPresentation(-50).className,'roi-negative');
  assert.match(roiPresentation(-50).label,/negativo/);
  assert.equal(roiPresentation(0).text,'0,00%');
  assert.equal(roiPresentation(-0).className,'roi-neutral');
});

test('zero absent stale invalid or overflowing costs never produce a numeric ROI',()=>{
  const row=fixture().financial[0];
  for(const value of [0,null,undefined,'50',-1,Number.NaN,Infinity])assert.equal(mediaRoi({...row,media_spend:value}),null);
  for(const value of [null,undefined,'100',-1,Number.NaN,Infinity])assert.equal(mediaRoi({...row,approved_revenue:value}),null);
  assert.equal(mediaRoi({...row,complete:false}),null);
  assert.equal(mediaRoi({...row,complete:null}),null);
  assert.equal(mediaRoi({...row,approved_revenue:Number.MAX_VALUE,media_spend:Number.MIN_VALUE}),null);
  assert.equal(mediaRoi(null),null);
  for(const value of [null,undefined,NaN,Infinity,'100']){
    assert.equal(roiPresentation(value).text,'—');
    assert.equal(roiPresentation(value).className,'roi-neutral');
  }
});

test('financial display communicates ROI sign accessibly and identifies current channel scope',()=>{
  const metrics=fixture();
  const positive=renderAds(metrics);
  assert.match(positive,/class="roi-positive" aria-label="ROI de mídia positivo: \+100,00%">\+100,00%/);
  assert.match(positive,/Receita aprovada de todas as fontes registradas/);
  assert.match(positive,/Escopo atual: receita de todas as fontes registradas e mídia Meta Ads/);
  assert.match(positive,/não comprova atribuição à Meta/);
  metrics.financial[0].approved_revenue=25;metrics.financial[0].revenue_after_media=-25;
  assert.match(renderAds(metrics),/class="roi-negative" aria-label="ROI de mídia negativo: -50,00%">-50,00%/);
  metrics.financial[0].complete=false;
  assert.match(renderAds(metrics),/class="roi-neutral" aria-label="ROI de mídia indisponível">—/);
  const empty=renderAds({version:1,from:'2026-10-01',until:'2026-10-29',accounts:[],campaigns:[],financial:[]});
  assert.match(empty,/Campanhas e retorno/);
  assert.match(empty,/Google Ads, Taboola e outras plataformas precisam de seus próprios conectores/);
});

test('account IDs stay canonical nonzero decimal strings without arbitrary five digit minimum',()=>{
  const metrics=fixture();metrics.accounts[0].external_account_id='1';
  assert.doesNotThrow(()=>validateAdsMetrics(metrics));
  for(const id of ['0','0001','act_1','-1','123456789012345678901234567890123']){
    const invalid=fixture();invalid.accounts[0].external_account_id=id;
    assert.throws(()=>validateAdsMetrics(invalid),/incompatíveis/);
  }
});
