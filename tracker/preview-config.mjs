/** Public staging-only coordinates, never credentials or workspace identifiers. */
export const EMBARQUE_PREVIEW = Object.freeze({
  projectRef:'osgumasejgumqlnqxcvm',
  origin:'https://pulso-campanhas-staging.fersthome.chatgpt.site',
  path:'/teste-ingles-de-embarque/',
  collectorUrl:'https://osgumasejgumqlnqxcvm.supabase.co/functions/v1/pulso-collect',
  publicSiteKey:'embarque_preview_20261029',
  policyVersion:'embarque-preview-consent-v1',
});
export function isEmbarquePreviewLocation(value){
  try{
    const url=new URL(value);
    return !url.username && !url.password && url.origin===EMBARQUE_PREVIEW.origin &&
      [EMBARQUE_PREVIEW.path,EMBARQUE_PREVIEW.path+'index.html'].includes(url.pathname);
  }catch{return false;}
}
