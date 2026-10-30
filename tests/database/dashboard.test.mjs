import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,seedWorkspaces,asUser,asRole,ids} from './helpers.mjs';

test('dashboard aggregates real fixture rows, isolates tenants, and keeps currencies separate',async()=>{
 const sandbox=await isolatedDatabase();const {db}=sandbox;
 try {
  await seedWorkspaces(db);
  const session=(await db.query("insert into public.tracking_sessions(workspace_id,public_session_id,utm_source,utm_medium,utm_campaign) values($1,'33333333-3333-4333-8333-333333333333','meta','paid','Synthetic campaign') returning id",[ids.wa])).rows[0].id;
  const sale=(await db.query("insert into public.sales(workspace_id,external_transaction_id,product_name,currency,gross_amount,status,purchased_at,src,sck,raw) values($1,'SYNTHETIC-ONLY-A','Synthetic product','USD',100,'APPROVED',now(),'DO_NOT_EXPOSE','DO_NOT_EXPOSE','{\"buyer\":\"DO_NOT_EXPOSE\"}') returning id",[ids.wa])).rows[0].id;
  await db.query("insert into public.sales(workspace_id,external_transaction_id,currency,gross_amount,status,purchased_at) values($1,'SYNTHETIC-ONLY-B','USD',999,'APPROVED',now()),($2,'SYNTHETIC-ONLY-EUR','EUR',50,'COMPLETE',now()),($2,'SYNTHETIC-ONLY-REFUND','USD',10,'REFUNDED',now())",[ids.wb,ids.wa]);
  await db.query("insert into public.attributions(workspace_id,sale_id,tracking_session_id,method,confidence,evidence) values($1,$2,$3,'session_id','high','{\"private_context\":\"DO_NOT_EXPOSE\"}')",[ids.wa,sale,session]);
  await db.query("insert into public.funnel_events(workspace_id,tracking_session_id,event_name) values($1,$2,'page_view'),($1,$2,'page_view'),($1,$2,'checkout_click'),($1,$2,'checkout_started')",[ids.wa,session]);
  const result=await asUser(db,ids.a,"select public.pulso_dashboard_metrics($1,now()-interval '1 day') as metrics",[ids.wa]);
  const metrics=result.rows[0].metrics;
  const usd=metrics.currency_summary.find(item=>item.currency==='USD');
  const eur=metrics.currency_summary.find(item=>item.currency==='EUR');
  assert.equal(usd.approved_revenue,100);assert.equal(eur.approved_revenue,50);
  assert.equal(usd.attributed_orders,1);assert.equal(usd.unattributed_orders,0);assert.equal(eur.unattributed_orders,1);
  assert.equal(usd.reversed_orders,1);assert.equal(metrics.funnel.visits,1);assert.equal(metrics.funnel.page_view,2);
  assert.equal(metrics.funnel.checkout_click,1);assert.equal(metrics.funnel.checkout_started,1);
  assert.equal(metrics.sources.find(item=>item.utm_source==='meta').utm_campaign,'Synthetic campaign');
  assert.ok(!JSON.stringify(metrics).includes('DO_NOT_EXPOSE'));assert.ok(!JSON.stringify(metrics).includes('SYNTHETIC-ONLY'));
  await assert.rejects(asUser(db,ids.a,"select public.pulso_dashboard_metrics($1,now()-interval '1 day')",[ids.wb]),error=>error.code==='42501');
  await assert.rejects(asRole(db,'anon',"select public.pulso_dashboard_metrics($1,now()-interval '1 day')",[ids.wa]),error=>error.code==='42501');
  await assert.rejects(asUser(db,ids.a,"select public.pulso_dashboard_metrics($1,null)",[ids.wa]),error=>error.code==='22023');
 } finally {await sandbox.close()}
});
