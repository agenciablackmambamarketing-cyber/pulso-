import test from 'node:test';
import assert from 'node:assert/strict';
import { planFreshDatabase } from '../scripts/plan-fresh-database.mjs';

test('new database plan is deterministic, ordered, and only reads existing source', async () => {
  const first = await planFreshDatabase();
  const second = await planFreshDatabase();
  assert.deepEqual(first, second);
  assert.equal(first.target, null);
  assert.equal(first.database_changed, false);
  assert.equal(first.files.length, 8);
  assert.equal(first.files[0].path, 'supabase/baseline/observed-2026-10-28.sql');
  assert.ok(first.files.slice(1).every(item => /^supabase\/migrations\/\d{14}_.+\.sql$/.test(item.path)));
  assert.deepEqual(first.files.slice(1).map(item => item.path), first.files.slice(1).map(item => item.path).sort());
  assert.ok(first.files.every(item => /^[0-9a-f]{64}$/.test(item.sha256)));
  assert.ok(first.files.every(item => !item.path.includes('20261025_pulso_core.sql')));
});

test('historic environments and invalid project references cannot be targeted', async () => {
  for (const ref of ['nlrhtioxsbncpluchfcz', 'osgumasejgumqlnqxcvm', '', '../etc/passwd', 'bad-ref', 'A'.repeat(20)]) {
    await assert.rejects(planFreshDatabase({projectRef: ref}), /novo projeto isolado/);
  }
  assert.equal((await planFreshDatabase({projectRef: 'abcdefghijklmnopqrst'})).target, 'abcdefghijklmnopqrst');
});

test('missing or incomplete source cannot produce an apparently valid plan', async () => {
  await assert.rejects(planFreshDatabase({root:'/path/that/does/not/exist'}));
});
