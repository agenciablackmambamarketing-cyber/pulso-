import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase, seedWorkspaces, asUser, asRole, ids} from './helpers.mjs';

test('effective PostgreSQL permissions deny raw identifiers, credential mutation and unauthorized actor claims', async t => {
  const fixture = await isolatedDatabase();
  const {db} = fixture;
  t.after(() => fixture.close());
  await seedWorkspaces(db);

  await t.test('every private table denies schema/table access to both browser roles', async () => {
    const tables = await db.query("select tablename from pg_tables where schemaname='private'");
    for (const {tablename} of tables.rows) {
      for (const role of ['anon','authenticated']) {
        await assert.rejects(asRole(db, role, `select * from private."${tablename}" limit 0`), error => error.code === '42501');
      }
    }
  });

  await t.test('no sensitive public column remains readable even when selecting zero rows', async () => {
    const protectedColumns = {
      sales: ['raw','src','sck','xcod','external_transaction_id'],
      tracking_sessions: ['public_session_id','landing_page','fbclid','gclid','gbraid','wbraid','tblci','src'],
      funnel_events: ['external_event_id','tracking_session_id','metadata','page_url'],
      order_events: ['external_event_id','transaction_id'],
      financial_ledger: ['external_id'],
    };
    for (const [table, columns] of Object.entries(protectedColumns)) {
      for (const column of columns) {
        await assert.rejects(asUser(db,ids.a,`select "${column}" from public."${table}" limit 0`), error => error.code === '42501', `${table}.${column}`);
      }
    }
  });

  await t.test('browser cannot bypass Meta credential verification through destination writes', async () => {
    const {rows:[integration]} = await db.query("insert into public.integrations(workspace_id,provider,status) values($1,'meta','pending') returning id",[ids.wa]);
    await assert.rejects(asUser(db,ids.a,"insert into public.conversion_destinations(workspace_id,integration_id,provider,destination_id,label,is_active) values($1,$2,'meta','123456789','Forged',true)",[ids.wa,integration.id]), error => error.code==='42501');
  });

  await t.test('caller cannot forge a privileged user_id in service-only RPCs', async () => {
    await assert.rejects(asUser(db,ids.b,'select public.pulso_meta_authorize($1,$2)',[ids.wa,ids.a]),error=>error.code==='42501');
    await assert.rejects(asUser(db,ids.b,'select public.register_hotmart_source($1,$2,$3,$4)',[ids.wa,ids.a,'Forged','synthetic-never-real-token']),error=>error.code==='42501');
    await assert.rejects(asUser(db,ids.b,'select public.configure_tracking_site($1,$2,$3,$4)',[ids.wa,'forged_site_key',['https://example.invalid'],'v1']), /access denied/i);
    assert.equal(Number((await db.query('select count(*) from private.tracking_sites')).rows[0].count),0);
  });
});
