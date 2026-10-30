import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateFunnel,renderFunnel,validateFunnel} from '../dashboard/funnel.mjs';

const fixture=(counts=[100,70,35,14],overrides={})=>({
  version:1,basis:'ordered_sessions',since:'2026-10-28T00:00:00Z',until:'2026-10-29T01:00:00+00:00',
  stages:['page_view','view_content','checkout_click','checkout_started'].map((key,index)=>({key,sessions:counts[index]})),
  observed_checkout_sessions:counts[3],incomplete_path_sessions:0,...overrides,
});

test('funnel rates compare ordered sessions and highlight the largest drop in volume',()=>{
  const report=calculateFunnel(fixture());
  assert.equal(report.stages[1].advancement,70);
  assert.equal(report.stages[2].advancement,50);
  assert.equal(report.stages[3].advancement,40);
  assert.ok(Math.abs(report.stages[3].share-14)<1e-9);
  assert.equal(report.stages[2].notAdvanced,35);
  assert.equal(report.stages[2].notAdvancedPercent,50);
  assert.deepEqual(report.largestDrop,{from:'Conteúdo visualizado',to:'Clique para comprar',key:'checkout_click',sessions:35,percent:50});
  const html=renderFunnel(fixture());
  assert.match(html,/35 \(50%\) não avançaram até agora/);
  assert.equal((html.match(/class="funnel-stage(?: |")/g)||[]).length,4);
  assert.match(html,/<ol class="funnel-stages">/);
  assert.match(html,/Sessões únicas/);
});

test('missing checkout signals are unavailable rather than a fabricated 100 percent loss',()=>{
  const report=calculateFunnel(fixture([100,100,100,0]));
  assert.equal(report.checkoutObserved,false);
  assert.equal(report.stages[3].measured,false);
  assert.equal(report.stages[3].advancement,null);
  assert.equal(report.stages[3].notAdvanced,null);
  assert.equal(report.stages[3].share,null);
  assert.equal(report.largestDrop,null);
  const html=renderFunnel(fixture([100,100,100,0]));
  assert.match(html,/Não medido/);
  assert.match(html,/Não calculamos abandono nessa passagem sem esse sinal/);
  assert.doesNotMatch(html,/100 \(100%\) não avançaram/);
});

test('zero denominators do not create NaN, Infinity or invented percentages',()=>{
  const report=calculateFunnel(fixture([10,0,0,0]));
  assert.equal(report.stages[1].advancement,0);
  assert.equal(report.stages[1].notAdvanced,10);
  assert.equal(report.stages[2].advancement,null);
  assert.equal(report.stages[2].notAdvanced,null);
  assert.equal(report.largestDrop.key,'view_content');
  const html=renderFunnel(fixture([10,0,0,0]));
  assert.match(html,/Taxa indisponível/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});

test('empty cohort guides setup without presenting demonstration conversions',()=>{
  const html=renderFunnel(fixture([0,0,0,0]));
  assert.match(html,/Nenhuma sessão com visita à página/);
  assert.match(html,/Salvar a conexão Hotmart não mede as visitas/);
  assert.doesNotMatch(html,/funnel-fill|não avançaram até agora|0%/);
});

test('invalid values and inconsistent cohort counts fail closed',()=>{
  for(const invalid of [-1,0.5,'70',Number.NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
    const value=fixture();value.stages[1].sessions=invalid;
    assert.throws(()=>validateFunnel(value),/incompatíveis/);
  }
  for(const counts of [[100,101,35,14],[100,70,71,14],[100,70,35,36]])assert.throws(()=>validateFunnel(fixture(counts)),/incompatíveis/);
  for(const overrides of [{version:2},{basis:'events'},{observed_checkout_sessions:101},{observed_checkout_sessions:13},{incomplete_path_sessions:101},{since:'2026-10-30T00:00:00Z'},{since:'not-a-date'},{until:'2026-99-99T00:00:00Z'}]){
    assert.throws(()=>validateFunnel(fixture(undefined,overrides)),/incompatíveis/);
  }
  assert.throws(()=>validateFunnel({...fixture(),stages:fixture().stages.slice(1)}),/incompatíveis/);
  assert.throws(()=>validateFunnel(undefined),/incompatíveis/);
});

test('untrusted labels, markup and provider errors are never reflected into rendered HTML',()=>{
  const attack='<img src=x onerror="alert(1)">';
  const values=[fixture(undefined,{since:attack}),fixture(undefined,{label:attack}),fixture()];
  values[2].stages[0].key=attack;
  for(const value of values){
    const html=renderFunnel(value);
    assert.match(html,/Não foi possível carregar o funil/);
    assert.match(html,/Nenhum valor foi substituído por zero/);
    assert.doesNotMatch(html,/<img|onerror|alert\(/);
  }
});

test('incomplete instrumentation remains a visible diagnosis rather than confirmed abandonment',()=>{
  const html=renderFunnel(fixture([10,8,4,2],{observed_checkout_sessions:4,incomplete_path_sessions:3}));
  assert.match(html,/3 sessões têm etapas ausentes ou fora de ordem/);
  assert.match(html,/isso não comprova abandono/);
  assert.match(html,/não comprova cobertura de todos os acessos/);
  assert.match(html,/Sessões não equivalem a pessoas ou leads identificados/);
  assert.match(html,/ausência de evento pode indicar saída, atraso ou falha de medição/);
});
