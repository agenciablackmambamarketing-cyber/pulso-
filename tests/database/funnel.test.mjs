import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isolatedDatabase, seedWorkspaces, asUser, asRole, ids} from './helpers.mjs';

const stageKeys = ['page_view', 'view_content', 'checkout_click', 'checkout_started'];
const hour = 60 * 60 * 1000;
const minute = 60 * 1000;

async function fixture() {
  const sandbox = await isolatedDatabase();
  await seedWorkspaces(sandbox.db);
  const now = (await sandbox.db.query('select now() as value')).rows[0].value.getTime();
  return {...sandbox, now, since: new Date(now - 24 * hour), anchor: now - 3 * hour};
}

async function session(db, workspace, firstSeen) {
  const result = await db.query(
    'insert into public.tracking_sessions(workspace_id, public_session_id, first_seen_at, last_seen_at, landing_page) values($1,$2,$3,$3,$4) returning id',
    [workspace, randomUUID(), new Date(firstSeen), 'https://example.invalid/DO_NOT_EXPOSE_SESSION'],
  );
  return result.rows[0].id;
}

async function event(db, workspace, sessionId, name, at, eventId = randomUUID()) {
  await db.query(
    `insert into public.funnel_events(workspace_id, tracking_session_id, event_name, occurred_at, external_event_id, page_url, metadata)
     values($1,$2,$3,$4,$5,$6,$7)
     on conflict(workspace_id, external_event_id) where external_event_id is not null do nothing`,
    [workspace, sessionId, name, new Date(at), eventId, 'https://example.invalid/DO_NOT_EXPOSE_EVENT', {private_marker:'DO_NOT_EXPOSE_METADATA'}],
  );
  return eventId;
}

async function funnel(db, workspace, since, user = ids.a) {
  const result = await asUser(db, user, 'select public.pulso_dashboard_funnel($1,$2) as funnel', [workspace, since]);
  return result.rows[0].funnel;
}

function counts(value) {
  assert.equal(value.version, 1);
  assert.equal(value.basis, 'ordered_sessions');
  assert.deepEqual(value.stages.map(stage => stage.key), stageKeys);
  assert.ok(Number.isFinite(Date.parse(value.since)));
  assert.ok(Number.isFinite(Date.parse(value.until)));
  return value.stages.map(stage => stage.sessions);
}

test('funnel follows the same unique sessions and never counts repeat events as more visitors', async () => {
  const sandbox = await fixture();
  const {db, since, anchor} = sandbox;
  try {
    const sessionIds = [];
    for (let index = 0; index < 10; index++) {
      const sessionId = await session(db, ids.wa, anchor);
      sessionIds.push(sessionId);
      for (let stage = 0; stage < stageKeys.length; stage++) {
        if (index >= [10, 7, 4, 2][stage]) continue;
        const at = anchor + (stage + 1) * minute;
        const eventId = await event(db, ids.wa, sessionId, stageKeys[stage], at);
        // A true transport retry retains its event ID; another visit to the same
        // step gets a new event ID. Neither creates another session in the funnel.
        await event(db, ids.wa, sessionId, stageKeys[stage], at, eventId);
        await event(db, ids.wa, sessionId, stageKeys[stage], at + 1000);
      }
    }
    const otherTenant = await session(db, ids.wb, anchor);
    for (let stage = 0; stage < stageKeys.length; stage++) {
      await event(db, ids.wb, otherTenant, stageKeys[stage], anchor + (stage + 1) * minute);
    }

    const result = await funnel(db, ids.wa, since);
    assert.deepEqual(counts(result), [10, 7, 4, 2]);
    assert.equal(result.observed_checkout_sessions, 2);
    assert.equal(result.incomplete_path_sessions, 0);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('DO_NOT_EXPOSE'));
    for (const id of [...sessionIds, otherTenant, ids.wa, ids.wb]) assert.ok(!serialized.includes(id));
    assert.deepEqual(counts(await funnel(db, ids.wb, since, ids.b)), [1, 1, 1, 1]);
  } finally { await sandbox.close(); }
});

test('funnel requires chronological steps, accepts equal timestamps, and recovers when a later valid step arrives', async () => {
  const sandbox = await fixture();
  const {db, since, anchor} = sandbox;
  try {
    const recovered = await session(db, ids.wa, anchor);
    await event(db, ids.wa, recovered, 'page_view', anchor + 10 * minute);
    await event(db, ids.wa, recovered, 'checkout_click', anchor + 12 * minute);
    await event(db, ids.wa, recovered, 'checkout_started', anchor + 13 * minute);
    await event(db, ids.wa, recovered, 'view_content', anchor + 20 * minute);
    await event(db, ids.wa, recovered, 'checkout_click', anchor + 30 * minute);
    await event(db, ids.wa, recovered, 'checkout_started', anchor + 40 * minute);

    const outOfOrder = await session(db, ids.wa, anchor);
    await event(db, ids.wa, outOfOrder, 'page_view', anchor + 10 * minute);
    await event(db, ids.wa, outOfOrder, 'checkout_click', anchor + 15 * minute);
    await event(db, ids.wa, outOfOrder, 'view_content', anchor + 20 * minute);
    await event(db, ids.wa, outOfOrder, 'checkout_started', anchor + 25 * minute);

    const tied = await session(db, ids.wa, anchor);
    for (const name of stageKeys) await event(db, ids.wa, tied, name, anchor + 10 * minute);

    const missingContent = await session(db, ids.wa, anchor);
    await event(db, ids.wa, missingContent, 'page_view', anchor + 10 * minute);
    await event(db, ids.wa, missingContent, 'checkout_click', anchor + 30 * minute);

    const result = await funnel(db, ids.wa, since);
    assert.deepEqual(counts(result), [4, 3, 2, 2]);
    assert.equal(result.observed_checkout_sessions, 3);
    assert.equal(result.incomplete_path_sessions, 2);
  } finally { await sandbox.close(); }
});

test('funnel excludes earlier cohorts, future events, orphan events, and sessions without a page view', async () => {
  const sandbox = await fixture();
  const {db, now, since, anchor} = sandbox;
  try {
    const old = await session(db, ids.wa, since.getTime() - hour);
    for (const name of stageKeys) await event(db, ids.wa, old, name, anchor);

    const boundary = await session(db, ids.wa, since.getTime());
    for (const name of stageKeys) await event(db, ids.wa, boundary, name, since.getTime());

    const futureSteps = await session(db, ids.wa, anchor);
    await event(db, ids.wa, futureSteps, 'page_view', anchor + minute);
    for (const name of stageKeys.slice(1)) await event(db, ids.wa, futureSteps, name, now + hour);

    const futureSession = await session(db, ids.wa, now + hour);
    for (const name of stageKeys) await event(db, ids.wa, futureSession, name, now + hour);

    const noPage = await session(db, ids.wa, anchor);
    for (const name of stageKeys.slice(1)) await event(db, ids.wa, noPage, name, anchor + minute);
    for (const name of stageKeys) await event(db, ids.wa, null, name, anchor);

    const result = await funnel(db, ids.wa, since);
    assert.deepEqual(counts(result), [2, 1, 1, 1]);
    assert.equal(result.observed_checkout_sessions, 1);
    assert.equal(result.incomplete_path_sessions, 0);
  } finally { await sandbox.close(); }
});

test('empty cohorts and unconfirmed checkout remain zero observations without inventing progress', async () => {
  const sandbox = await fixture();
  const {db, since, anchor} = sandbox;
  try {
    const empty = await funnel(db, ids.wa, since);
    assert.deepEqual(counts(empty), [0, 0, 0, 0]);
    assert.equal(empty.observed_checkout_sessions, 0);
    assert.equal(empty.incomplete_path_sessions, 0);

    const clickOnly = await session(db, ids.wa, anchor);
    for (let stage = 0; stage < 3; stage++) {
      await event(db, ids.wa, clickOnly, stageKeys[stage], anchor + (stage + 1) * minute);
    }
    const result = await funnel(db, ids.wa, since);
    assert.deepEqual(counts(result), [1, 1, 1, 0]);
    assert.equal(result.observed_checkout_sessions, 0);
    assert.equal(result.incomplete_path_sessions, 0);
  } finally { await sandbox.close(); }
});

test('funnel RPC denies other tenants and invalid windows without opening identifier-bearing columns', async () => {
  const sandbox = await fixture();
  const {db, since, now} = sandbox;
  try {
    const query = 'select public.pulso_dashboard_funnel($1,$2)';
    await assert.rejects(asUser(db, ids.a, query, [ids.wb, since]), error => error.code === '42501');
    await assert.rejects(asUser(db, randomUUID(), query, [ids.wa, since]), error => error.code === '42501');
    await assert.rejects(asRole(db, 'anon', query, [ids.wa, since]), error => error.code === '42501');
    await assert.rejects(asRole(db, 'authenticated', query, [ids.wa, since]), error => error.code === '42501');
    await assert.rejects(asUser(db, ids.a, query, [null, since]), error => error.code === '42501');
    for (const invalidSince of [null, new Date(now + hour), new Date(now - 367 * 24 * hour)]) {
      await assert.rejects(asUser(db, ids.a, query, [ids.wa, invalidSince]), error => error.code === '22023');
    }
    await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')", [ids.wa, ids.b]);
    assert.deepEqual(counts(await funnel(db, ids.wa, since, ids.b)), [0, 0, 0, 0]);
    await db.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2', [ids.wa, ids.b]);
    await assert.rejects(asUser(db, ids.b, query, [ids.wa, since]), error => error.code === '42501');
    await assert.rejects(asUser(db, ids.a, 'select tracking_session_id from public.funnel_events'), error => error.code === '42501');
    await assert.rejects(asUser(db, ids.a, 'select hottok_sha256 from private.hotmart_sources'), error => error.code === '42501');
    await assert.rejects(asUser(db, ids.a, 'select * from private.visitor_match_context'), error => error.code === '42501');
    const exposed = (await db.query(`
      select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='pulso_dashboard_funnel'
    `)).rows;
    assert.equal(exposed.length, 1);
    assert.equal(exposed[0].prosecdef, false, 'public aggregate wrapper remains SECURITY INVOKER');
  } finally { await sandbox.close(); }
});
