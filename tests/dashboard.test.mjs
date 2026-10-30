import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {escapeHtml, currencyAmount, selectCurrency, createRequestScope, metricForCurrency, validateMetrics} from '../dashboard/metrics.mjs';

test('money never combines currencies or substitutes invalid amounts for zero',()=>{
  assert.equal(selectCurrency([{currency:'USD'},{currency:'EUR'}],'BRL'),'USD');
  const metrics={currency_summary:[{currency:'USD',approved_revenue:35},{currency:'EUR',approved_revenue:70}]};
  assert.equal(metricForCurrency(metrics,'USD').approved_revenue,35);
  assert.equal(currencyAmount('not-a-number','USD'),'—');
  assert.equal(currencyAmount(20,'bad'),'—');
});
test('invalid metrics fail closed rather than show fictional zeroes',()=>{
  assert.throws(()=>validateMetrics({currency_summary:[]}),/incompatível/);
  const valid={currency_summary:[],sources:[],daily_revenue:[],health:[],capi:[],funnel:{visits:0}};
  assert.equal(validateMetrics(valid),valid);
});
test('workspace switch and logout invalidate stale requests',()=>{
  const scope=createRequestScope();
  const workspaceA=scope.begin();const workspaceB=scope.begin();
  assert.equal(scope.current(workspaceA),false);assert.equal(scope.current(workspaceB),true);
  scope.invalidate();assert.equal(scope.current(workspaceB),false);
});
test('business labels rendered as text are HTML escaped',()=>{
  assert.equal(escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});
test('dashboard queries no buyer payload or private matching data and clears entered secrets',async()=>{
  const source=await readFile(new URL('../dashboard/app.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.select\(['"]\*/);
  for(const field of ['external_transaction_id','client_ip','client_user_agent','email_sha256','phone_sha256','visitor_match_context','conversion_event_outbox'])assert.ok(!source.includes(field),field);
  assert.match(source,/\$\('metaToken'\)\.value=''/);
  assert.match(source,/\$\('hotmartHottok'\)\.value=''/);
  assert.match(source,/requests\.current\(request\)/);
});
