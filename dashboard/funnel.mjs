import {escapeHtml} from './metrics.mjs';

const STAGES = Object.freeze([
  {key:'page_view',label:'Página visitada'},
  {key:'view_content',label:'Conteúdo visualizado'},
  {key:'checkout_click',label:'Clique para comprar'},
  {key:'checkout_started',label:'Checkout confirmado'},
]);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const number = value => new Intl.NumberFormat('pt-BR').format(value);
const percent = value => value === null ? '—' : new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value)+'%';
const ratio = (value,total) => total > 0 ? value / total * 100 : null;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ROOT_KEYS = new Set(['version','basis','since','until','stages','observed_checkout_sessions','incomplete_path_sessions']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function incompatible(){throw new Error('Dados do funil incompatíveis. Verifique a configuração do relatório.');}

/** Only aggregate counts enter the presentation layer. No backend labels/HTML. */
export function validateFunnel(value){
  if(!object(value) || Object.keys(value).some(key=>!ROOT_KEYS.has(key)) || value.version !== 1 || value.basis !== 'ordered_sessions' ||
    !Array.isArray(value.stages) || value.stages.length !== STAGES.length ||
    typeof value.since !== 'string' || typeof value.until !== 'string' ||
    !ISO.test(value.since) || !ISO.test(value.until) ||
    !Number.isFinite(Date.parse(value.since)) || !Number.isFinite(Date.parse(value.until)) ||
    Date.parse(value.since) > Date.parse(value.until)) incompatible();
  let previous = Infinity;
  for(let i=0;i<STAGES.length;i++){
    const stage=value.stages[i];
    if(!object(stage) || Object.keys(stage).some(key=>!['key','sessions'].includes(key)) || stage.key !== STAGES[i].key || !whole(stage.sessions) || stage.sessions > previous) incompatible();
    previous=stage.sessions;
  }
  const total=value.stages[0].sessions;
  if(!whole(value.observed_checkout_sessions) || value.observed_checkout_sessions > total ||
    value.observed_checkout_sessions < value.stages[3].sessions ||
    !whole(value.incomplete_path_sessions) || value.incomplete_path_sessions > total) incompatible();
  return value;
}

/** Losses compare the same ordered session cohort, never independent event totals. */
export function calculateFunnel(input){
  const value=validateFunnel(input);
  const total=value.stages[0].sessions;
  const stages=value.stages.map((item,index)=>{
    const measured=index !== 3 || value.observed_checkout_sessions > 0;
    const previous=index > 0 ? value.stages[index-1].sessions : null;
    return {...STAGES[index],sessions:item.sessions,measured,
      share:measured ? ratio(item.sessions,total) : null,
      advancement:measured && previous !== null ? ratio(item.sessions,previous) : null,
      notAdvanced:measured && previous !== null && previous > 0 ? previous-item.sessions : null,
      notAdvancedPercent:measured && previous !== null && previous > 0 ? ratio(previous-item.sessions,previous) : null};
  });
  let largestDrop=null;
  for(let i=1;i<stages.length;i++){
    const stage=stages[i];
    if(stage.notAdvanced !== null && stage.notAdvanced > 0 && (!largestDrop || stage.notAdvanced > largestDrop.sessions)){
      largestDrop={from:stages[i-1].label,to:stage.label,key:stage.key,sessions:stage.notAdvanced,percent:stage.notAdvancedPercent};
    }
  }
  return {total,stages,largestDrop,incompletePaths:value.incomplete_path_sessions,checkoutObserved:value.observed_checkout_sessions > 0};
}

export function renderFunnel(input){
  let report;
  try{report=calculateFunnel(input);}catch{
    return '<div class="empty" role="status">Não foi possível carregar o funil. Nenhum valor foi substituído por zero ou demonstração.</div>';
  }
  if(report.total === 0){
    return '<div class="card"><h2>Seu funil começa com uma visita rastreada</h2><p class="sub">Nenhuma sessão com visita à página foi registrada neste período.</p><div class="empty section">Aguardando dados reais da página de vendas.</div><p class="note section">Instale o rastreador do Pulso na página e valide o consentimento e os eventos. Salvar a conexão Hotmart não mede as visitas à página.</p></div>';
  }
  const esc=escapeHtml;
  const click=report.stages[2];
  const drop=report.largestDrop;
  const cards='<div class="funnel-summary">'+
    '<div class="card metric"><div class="name">SESSÕES NA PÁGINA</div><div class="value">'+esc(number(report.total))+'</div><div class="foot">Entradas rastreadas no período</div></div>'+
    '<div class="card metric"><div class="name">CHEGARAM AO CLIQUE</div><div class="value">'+esc(percent(click.share))+'</div><div class="foot">'+esc(number(click.sessions))+' sessões na sequência medida</div></div>'+
    '<div class="card metric"><div class="name">MAIOR QUEDA EM VOLUME</div><div class="value">'+(drop?esc(number(drop.sessions)):'—')+'</div><div class="foot">'+(drop?esc(drop.from+' → '+drop.to):'Nenhuma queda nas etapas medidas')+'</div></div></div>';
  const stages=report.stages.map((stage,index)=>{
    const unmeasured=!stage.measured;
    const width=stage.share === null ? 0 : stage.share;
    const transition=index === 0
      ? '<span>Base do funil</span><span>100% das entradas</span>'
      : unmeasured
        ? '<span>Sem sinal de abertura neste período</span><span>Passagem ainda não medida</span>'
        : stage.advancement === null
          ? '<span>Sem sessões na etapa anterior</span><span>Taxa indisponível</span>'
          : '<span><strong>'+esc(percent(stage.advancement))+'</strong> avançaram da etapa anterior</span><span>'+esc(number(stage.notAdvanced))+' ('+esc(percent(stage.notAdvancedPercent))+') não avançaram até agora</span>';
    return '<li class="funnel-stage'+(unmeasured?' is-unmeasured':'')+(drop?.key===stage.key?' is-focus':'')+'">'+
      '<div class="funnel-stage-head"><div class="funnel-stage-title"><span class="funnel-step" aria-hidden="true">'+String(index+1).padStart(2,'0')+'</span><div><h3>'+esc(stage.label)+'</h3><p class="note">'+(unmeasured?'Sem confirmação':esc(percent(stage.share))+' das sessões de entrada')+'</p></div></div><strong class="funnel-count">'+(unmeasured?'Não medido':esc(number(stage.sessions)))+'</strong></div>'+
      '<div class="funnel-track" aria-hidden="true"><div class="funnel-fill" style="width:'+width+'%"></div></div>'+
      '<div class="funnel-stage-details">'+transition+'</div></li>';
  }).join('');
  const diagnosis=report.incompletePaths > 0
    ? '<div class="notice section"><strong>Revise a sequência de medição.</strong> '+esc(number(report.incompletePaths))+' sessões têm etapas ausentes ou fora de ordem. Elas ficam fora das etapas seguintes do funil sequencial; isso não comprova abandono.</div>'
    : '';
  const checkout=report.checkoutObserved
    ? '<p class="note section">A etapa final considera somente sinais de abertura do checkout observados na sequência. A presença de sinais não comprova cobertura de todos os acessos.</p>'
    : '<div class="notice section"><strong>Abertura do checkout ainda sem confirmação.</strong> O clique é medido, mas a passagem até o checkout depende de um sinal real de abertura. Não calculamos abandono nessa passagem sem esse sinal.</div>';
  return cards+'<section class="card" aria-label="Etapas do funil"><div class="cardheader"><div><h2>Da visita ao checkout</h2><p class="sub">Acompanhe onde as mesmas sessões deixam de avançar.</p></div><span class="pill">Sessões únicas</span></div><ol class="funnel-stages">'+stages+'</ol>'+checkout+diagnosis+
    '<p class="note section">Cada sessão é contada uma vez por etapa, em ordem, a partir da visita no período selecionado e com rastreamento consentido. Sessões não equivalem a pessoas ou leads identificados. O período continua em andamento: ausência de evento pode indicar saída, atraso ou falha de medição.</p></section>';
}
