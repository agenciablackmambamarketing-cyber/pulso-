import {createPulsoTracker} from './pulso-tracker.mjs';
import {createPreviewSession,CONTENT_VISIBILITY_RATIO} from './preview-session.mjs';
import {EMBARQUE_PREVIEW,isEmbarquePreviewLocation} from './preview-config.mjs';

const $=id=>document.getElementById(id);
const feedback=$('pulso-tracking-status');
if(!isEmbarquePreviewLocation(location.href)){
  feedback.textContent='Medição bloqueada: esta cópia só funciona no endereço privado de testes do Pulso.';
  for(const button of document.querySelectorAll('.pulso-consent button'))button.disabled=true;
}else{
  let session;
  let pendingCheckout=null;
  let revocationPending=false;
  let resumeStorage=null;
  try{resumeStorage=globalThis.sessionStorage;}catch{/* Storage denial must not prevent consent choices. */}
  const tracker=createPulsoTracker({
    collectorUrl:EMBARQUE_PREVIEW.collectorUrl,publicSiteKey:EMBARQUE_PREVIEW.publicSiteKey,
    sessionStorage:resumeStorage,
    cookieHeader:()=>{try{return document.cookie;}catch{return '';}},
    marketingAllowed:()=>session?.allowed()===true,
    consentRecord:()=>session?.consentRecord(),
  });
  const eventLabels={page_view:'Visita registrada no Pulso de testes.',view_content:'Visualização da oferta registrada no Pulso de testes.',checkout_click:'Clique para comprar registrado. Abertura de checkout não confirmada.'};
  function updateChoice(){
    const allowed=session.allowed();
    $('pulso-revoke').hidden=!allowed;
    $('pulso-deny').hidden=allowed;
  }
  session=createPreviewSession({tracker,onStatus:status=>{
    if(status.event==='consent'){
      revocationPending=status.reason==='revocation_pending';
      feedback.textContent=session.allowed()?'Medição de teste autorizada.':'Medição desativada. Você pode continuar usando a página.';
      if(revocationPending)feedback.textContent='Medição desativada neste navegador. Reenvie a revogação para confirmar o bloqueio no servidor.';
    }else if(status.sent){revocationPending=false;feedback.textContent=eventLabels[status.event]||'Etapa registrada.';}
    else {feedback.textContent='Não foi possível registrar a etapa. Nenhum avanço foi presumido.';}
    $('pulso-retry').hidden=!revocationPending && (status.sent || !session.allowed());
    $('pulso-retry').textContent=revocationPending?'Reenviar revogação':'Tentar novamente';
    updateChoice();
  }});
  async function accept(){
    $('pulso-accept').disabled=true;$('pulso-retry').disabled=true;
    try{await session.accept();}catch{feedback.textContent='Não foi possível iniciar a medição. Tente novamente.';}
    finally{$('pulso-accept').disabled=false;$('pulso-retry').disabled=false;updateChoice();}
  }
  async function deny(){
    pendingCheckout=null;
    await session.revoke();updateChoice();
  }
  $('pulso-accept').addEventListener('click',accept);
  $('pulso-retry').addEventListener('click',async()=>{
    $('pulso-retry').disabled=true;
    try{
      if(revocationPending)await deny();
      else if(pendingCheckout)await checkout(pendingCheckout,false);
      else await accept();
    }finally{$('pulso-retry').disabled=false;}
  });
  $('pulso-deny').addEventListener('click',deny);
  $('pulso-revoke').addEventListener('click',deny);

  let lastVisibility={isIntersecting:false,intersectionRatio:0};
  const reportVisibility=()=>session.setVisible({
    isIntersecting:lastVisibility.isIntersecting && document.visibilityState==='visible',
    intersectionRatio:lastVisibility.intersectionRatio,
  }).catch(()=>{});
  const target=document.querySelector('.offerbox .price');
  if(target && typeof IntersectionObserver==='function'){
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.target===target){
        lastVisibility={isIntersecting:entry.isIntersecting,intersectionRatio:entry.intersectionRatio};
        reportVisibility();
      }
    },{threshold:[0,CONTENT_VISIBILITY_RATIO,1]});
    observer.observe(target);
    document.addEventListener('visibilitychange',reportVisibility);
  }
  async function checkout(url,focus=true){
    pendingCheckout=url;
    const notice=$('pulso-test-checkout');
    $('pulso-checkout-status').textContent='Registrando o clique de teste…';
    const result=await session.checkout(url).catch(()=>({sent:false}));
    if(result.sent || !session.allowed())pendingCheckout=null;
    $('pulso-checkout-status').textContent=result.sent
      ? 'Clique registrado no Pulso. Nenhum checkout foi aberto e nenhuma compra foi enviada.'
      : 'Clique não registrado. A medição precisa estar autorizada e conectada; nenhuma compra foi aberta.';
    if(focus){notice.focus({preventScroll:true});notice.scrollIntoView({block:'center',behavior:'auto'});}
  }
  for(const anchor of document.querySelectorAll('a.checkout[data-checkout-url]')){
    anchor.addEventListener('click',event=>{
      event.preventDefault();checkout(anchor.dataset.checkoutUrl).catch(()=>{});
    });
  }
}
