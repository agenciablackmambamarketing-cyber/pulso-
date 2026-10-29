import {escapeHtml as esc,currencyAmount} from './metrics.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const CURRENCY=/^[A-Z]{3}$/;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const amount=value=>typeof value==='number' && Number.isFinite(value);
const positive=value=>amount(value) && value>=0;
const nullable=(value,check)=>value===null || check(value);
const label=value=>typeof value==='string' && value.length<=500;
const whole=value=>Number.isSafeInteger(value) && value>=0;
const timestamp=value=>typeof value==='string' && Number.isFinite(Date.parse(value));
function date(value){
  if(typeof value!=='string'||!DATE.test(value))return false;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10)===value;
}
function incompatible(){throw new Error('Dados de anúncios incompatíveis. Verifique a sincronização.');}

/** Presentation receives business aggregates only and never reflects unknown fields. */
export function validateAdsMetrics(value){
  if(!object(value)||value.version!==1||!date(value.from)||!date(value.until)||value.from>value.until||
    !Array.isArray(value.accounts)||!Array.isArray(value.campaigns)||!Array.isArray(value.financial))incompatible();
  const accounts=new Map(),external=new Set();
  for(const account of value.accounts){
    if(!object(account)||!UUID.test(account.id)||accounts.has(account.id)||
      typeof account.external_account_id!=='string'||!/^[1-9]\d{0,31}$/.test(account.external_account_id)||external.has(account.external_account_id)||
      !label(account.name)||!CURRENCY.test(account.currency)||!label(account.timezone_name)||
      !['connected','error','revoked'].includes(account.status)||typeof account.complete!=='boolean'||
      !nullable(account.spend,positive)||!nullable(account.last_sync_at,timestamp)||
      !nullable(account.last_error_code,code=>typeof code==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(code))||
      (account.complete && (account.spend===null||account.last_sync_at===null)))incompatible();
    accounts.set(account.id,account);external.add(account.external_account_id);
  }
  const campaigns=new Set();
  for(const campaign of value.campaigns){
    const account=accounts.get(campaign?.account_id);
    if(!object(campaign)||!UUID.test(campaign.id)||campaigns.has(campaign.id)||!account||
      !label(campaign.name)||!label(campaign.account_name)||!label(campaign.status)||!label(campaign.effective_status)||
      campaign.currency!==account.currency||!nullable(campaign.spend,positive))incompatible();
    campaigns.add(campaign.id);
  }
  const currencies=new Set();
  for(const row of value.financial){
    if(!object(row)||!CURRENCY.test(row.currency)||currencies.has(row.currency)||!positive(row.approved_revenue)||
      !nullable(row.verified_net_revenue,amount)||!whole(row.refunded_orders)||!nullable(row.media_spend,positive)||
      !nullable(row.revenue_after_media,amount)||row.profit!==null||typeof row.complete!=='boolean'||
      (row.complete && (row.media_spend===null||row.revenue_after_media===null||
        Math.abs(row.revenue_after_media-(row.approved_revenue-row.media_spend))>.011)))incompatible();
    currencies.add(row.currency);
  }
  return value;
}

/** An incomplete response never turns unknown investment into a zero. */
export function adsForCurrency(input,currency){
  const value=validateAdsMetrics(input);
  if(!CURRENCY.test(currency))incompatible();
  const row=value.financial.find(item=>item.currency===currency);
  if(!row)return {currency,approved_revenue:null,verified_net_revenue:null,refunded_orders:null,media_spend:null,revenue_after_media:null,profit:null,complete:false};
  return {...row,media_spend:row.complete?row.media_spend:null,revenue_after_media:row.complete?row.revenue_after_media:null,profit:null};
}

/** Provider-independent blended return, using known costs only. Zero cost has no finite ROI. */
export function mediaRoi(row){
  if(!object(row)||row.complete!==true||!positive(row.approved_revenue)||!positive(row.media_spend)||row.media_spend===0)return null;
  const value=(row.approved_revenue/row.media_spend-1)*100;
  return Number.isFinite(value)?(Object.is(value,-0)?0:value):null;
}

/** Text and sign communicate the result independently of its color. */
export function roiPresentation(value){
  if(!amount(value))return {text:'—',className:'roi-neutral',label:'ROI de mídia indisponível'};
  const normalized=Object.is(value,-0)?0:value;
  const text=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'}).format(normalized)+'%';
  return {text,className:normalized>0?'roi-positive':normalized<0?'roi-negative':'roi-neutral',label:'ROI de mídia '+(normalized>0?'positivo':normalized<0?'negativo':'neutro')+': '+text};
}

const money=(value,currency)=>value===null?'—':currencyAmount(value,currency);
const day=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
const instant=value=>value===null?'Ainda não sincronizada':new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value));
const issues=Object.freeze({meta_ads_auth:'Acesso expirado; reconecte a conta.',meta_ads_permission:'Confira a permissão de leitura de anúncios.',meta_ads_transient:'A Meta está temporariamente indisponível.',sync_incomplete:'A sincronização não cobriu todo o período.'});
const issue=code=>Object.hasOwn(issues,code)?issues[code]:'Não foi possível concluir a sincronização.';
const coverage=code=>code==='timezone_mismatch'
  ? 'O fuso da conta de anúncios difere do workspace. Alinhe os fusos e o período antes de comparar vendas e investimento.'
  : code==='no_accounts'
    ? 'Conecte uma conta de anúncios para calcular o resultado após mídia.'
    : 'O período ainda não tem cobertura completa de mídia. Sincronize as contas para comparar o resultado.';

export function renderAds(input,{currency=null,canSync=false}={}){
  let value;
  try{value=validateAdsMetrics(input);if(currency!==null&&!CURRENCY.test(currency))incompatible();}catch{
    return '<div class="empty" role="status">Dados de anúncios indisponíveis. Nenhum gasto ou resultado foi substituído por zero.</div>';
  }
  if(!value.accounts.length){
    return '<div class="card"><h2>Campanhas e retorno</h2><p class="sub">Reúna vendas registradas e investimento das plataformas conectadas, por moeda e período.</p><div class="empty section">Nenhuma conta de anúncios conectada neste workspace.</div><p class="note section">A primeira integração de mídia disponível é Meta Ads, para Facebook e Instagram. Google Ads, Taboola e outras plataformas precisam de seus próprios conectores. Em Integrações, um proprietário ou administrador pode cadastrar a conta Meta com permissão de leitura de anúncios.</p></div>';
  }
  const accounts=value.accounts.filter(account=>currency===null||account.currency===currency);
  const accountMap=new Map(accounts.map(account=>[account.id,account]));
  const active=value.campaigns.filter(campaign=>campaign.effective_status==='ACTIVE'&&accountMap.has(campaign.account_id));
  const inventoryKnown=accounts.length>0 && accounts.every(account=>account.last_sync_at!==null);
  const financial=value.financial.filter(row=>currency===null||row.currency===currency).map(row=>adsForCurrency(value,row.currency));
  const totals=financial.length?'<div class="ads-financial">'+financial.map(row=>{const roi=roiPresentation(mediaRoi(row));return (
    '<section class="card" aria-label="Resultado em '+esc(row.currency)+'"><div class="cardheader"><h2>Resultado em '+esc(row.currency)+'</h2><span class="pill'+(row.complete?' good':'')+'">'+(row.complete?'Mídia sincronizada':'Cobertura incompleta')+'</span></div><dl class="ads-values">'+
    '<div><dt>Receita aprovada de todas as fontes registradas</dt><dd>'+esc(money(row.approved_revenue,row.currency))+'</dd></div>'+
    '<div><dt>Investimento Meta no período</dt><dd>'+esc(money(row.media_spend,row.currency))+'</dd></div>'+
    '<div class="ads-result"><dt>Receita aprovada após mídia</dt><dd>'+esc(money(row.revenue_after_media,row.currency))+'</dd></div>'+
    '<div><dt>ROI de mídia</dt><dd class="'+roi.className+'" aria-label="'+esc(roi.label)+'">'+esc(roi.text)+'</dd></div>'+
    '<div><dt>Lucro líquido</dt><dd>—</dd></div></dl>'+(!row.complete?'<p class="ads-warning">'+esc(coverage(row.coverage_reason))+'</p>':'')+'<p class="note">ROI de mídia = (receita aprovada − mídia) ÷ mídia × 100. Sem investimento ou cobertura completa, fica indisponível. Lucro líquido depende da conciliação de taxas, reembolsos e outros custos. Moedas são apresentadas separadamente.</p></section>'
  );}
  ).join('')+'</div>':'<div class="empty">Sem resumo financeiro nesta moeda.</div>';
  const rows=accounts.map(account=>{
    const status={connected:'Conectada',error:'Revisar acesso',revoked:'Revogada'}[account.status];
    return '<article class="ads-account"><div><h3>'+esc(account.name||'Conta Meta')+'</h3><p>Conta act_'+esc(account.external_account_id)+' · '+esc(account.currency)+' · '+esc(account.timezone_name)+'</p><p>Atualização: '+esc(instant(account.last_sync_at))+' (Brasília)</p>'+
      (account.last_error_code?'<p class="ads-warning">'+esc(issue(account.last_error_code))+'</p>':'')+
      (!account.complete?'<p class="ads-warning">O período ainda não foi totalmente sincronizado.</p>':'')+
      '</div><div class="ads-account-actions"><span class="pill'+(account.status==='connected'?' good':'')+'">'+esc(status)+'</span><strong>'+esc(money(account.complete?account.spend:null,account.currency))+'</strong><button class="btn" type="button" data-action="ads-sync" data-account="'+esc(account.id)+'" '+(!canSync||account.status==='revoked'?'disabled':'')+'>Sincronizar</button><button class="btn" type="button" data-action="ads-revoke" data-account="'+esc(account.id)+'" '+(!canSync||account.status==='revoked'?'disabled':'')+'>Revogar acesso</button></div></article>';
  }).join('');
  const campaigns=active.length?'<div class="table-scroll"><table><thead><tr><th>Campanha ativa</th><th>Conta</th><th>Moeda</th><th>Gasto no período</th></tr></thead><tbody>'+active.map(campaign=>
    '<tr><td>'+esc(campaign.name)+'</td><td>'+esc(campaign.account_name)+'</td><td>'+esc(campaign.currency)+'</td><td>'+esc(money(accountMap.get(campaign.account_id).complete?campaign.spend:null,campaign.currency))+'</td></tr>'
  ).join('')+'</tbody></table></div>':'<div class="empty">'+(inventoryKnown?'Nenhuma campanha com status ativo na última sincronização.':'Aguardando sincronização das contas para listar campanhas ativas.')+'</div>';
  return '<div class="notice ads-period"><strong>'+esc(day(value.from))+' a '+esc(day(value.until))+'</strong><span>Datas de mídia no fuso de cada conta · status na última sincronização</span><span>Escopo atual: receita de todas as fontes registradas e mídia Meta Ads. O retorno é agregado; não comprova atribuição à Meta. Outros canais de mídia ainda não estão conectados.</span></div>'+totals+
    '<section class="card section"><div class="cardheader"><div><h2>Contas de anúncios</h2><p class="sub">O total de mídia inclui campanhas pausadas que tiveram gasto no período.</p></div></div>'+rows+
    (!canSync?'<p class="note section">Somente proprietários e administradores podem sincronizar contas.</p>':'')+'</section>'+
    '<section class="card section"><div class="cardheader"><div><h2>Campanhas ativas</h2><p class="sub">'+(inventoryKnown?esc(String(active.length))+' campanha(s) com status ativo informado pela Meta.':'Há contas aguardando sincronização; a lista pode estar incompleta.')+'</p></div><span class="pill">Facebook e Instagram</span></div>'+campaigns+'</section>';
}
