/** Pure presentation helpers: inputs contain only authorized aggregate/business fields. */
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function currencyAmount(amount, currency = 'BRL') {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || !/^[A-Z]{3}$/.test(currency)) return '—';
  try { return new Intl.NumberFormat('pt-BR', {style:'currency', currency}).format(numeric); } catch { return '—'; }
}
export function selectCurrency(summary, selected, fallback = 'BRL') {
  const currencies = summary.map(item => item.currency).filter(currency => /^[A-Z]{3}$/.test(currency));
  return currencies.includes(selected) ? selected : currencies[0] || fallback;
}
export function createRequestScope() {
  let generation = 0;
  return {begin: () => ++generation, invalidate: () => ++generation, current: token => token === generation};
}
export function metricForCurrency(metrics, currency) {
  return metrics.currency_summary.find(item => item.currency === currency) || {
    currency, approved_orders:0, approved_revenue:0, reversed_orders:0, attributed_orders:0, unattributed_orders:0,
  };
}
export function validateMetrics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Array.isArray(value.currency_summary) || !Array.isArray(value.sources) || !Array.isArray(value.daily_revenue) ||
      !Array.isArray(value.health) || !Array.isArray(value.capi) || !value.funnel || typeof value.funnel !== 'object') {
    throw new Error('Resposta de métricas incompatível. Verifique as migrações do dashboard.');
  }
  return value;
}
