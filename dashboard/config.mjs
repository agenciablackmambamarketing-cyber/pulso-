/** Public deployment configuration only. No server keys are accepted here. */
const PRODUCTION_REF = 'nlrhtioxsbncpluchfcz';
const keys = new Set(['environment','project_ref','supabase_url','publishable_key']);
function invalid() { throw new Error('Configuração pública do ambiente ausente ou inválida.'); }
function legacyAnon(key, projectRef) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const decode = part => JSON.parse(atob(part.replaceAll('-','+').replaceAll('_','/')));
    const [head,payload] = key.split('.').slice(0,2).map(decode);
    return head.alg === 'HS256' && payload.role === 'anon' && payload.ref === projectRef;
  } catch { return false; }
}
export function validatePublicConfig(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !keys.has(key))) invalid();
  if (!['staging','production'].includes(value.environment) || !/^[a-z]{20}$/.test(value.project_ref ?? '')) invalid();
  if (value.environment === 'staging' && value.project_ref === PRODUCTION_REF) invalid();
  const expected = `https://${value.project_ref}.supabase.co`;
  if (value.supabase_url !== expected) invalid();
  const key = value.publishable_key;
  if (typeof key !== 'string' || !( /^sb_publishable_[A-Za-z0-9_-]{15,300}$/.test(key) || legacyAnon(key,value.project_ref))) invalid();
  return Object.freeze({...value});
}
export async function loadDashboardConfig(fetchImpl = fetch) {
  const response = await fetchImpl('./config.json', {cache:'no-store',credentials:'omit',redirect:'error'});
  if (!response.ok) invalid();
  return validatePublicConfig(await response.json());
}
export async function startConfiguredDashboard({fetchImpl = fetch, onReady, onError}) {
  try {
    const config = await loadDashboardConfig(fetchImpl);
    await onReady(config);
    return true;
  } catch {
    onError('Configuração do ambiente pendente. O painel não iniciou conexão com o Supabase.');
    return false;
  }
}
