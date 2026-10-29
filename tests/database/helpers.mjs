import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// An explicit opt-in endpoint avoids ever using SUPABASE_URL or linked project credentials.
export async function isolatedDatabase() {
  const connectionString = process.env.PULSO_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('Set PULSO_TEST_DATABASE_URL to a disposable local PostgreSQL instance');
  const url = new URL(connectionString);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Database tests only accept a loopback host; use an SSH tunnel for an isolated test DB');
  }
  const control = new pg.Client({ connectionString });
  await control.connect();
  const name = `pulso_test_${randomUUID().replaceAll('-', '')}`;
  await control.query(`create database ${name}`);
  url.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  // Roles are cluster-level: create only missing roles, never change existing production roles.
  const bootstrap = (await readFile(new URL('./auth-bootstrap.sql', import.meta.url), 'utf8'))
    .replace(/create role (anon|authenticated|service_role) ([^;]+);/g, (_s, role, attrs) =>
      `do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role} ${attrs}; end if; end $$;`);
  try {
    await db.query(bootstrap);
    await db.query(await readFile(new URL('../../supabase/baseline/observed-2026-10-28.sql', import.meta.url), 'utf8'));
    const migrations = await readdir(new URL('../../supabase/migrations/', import.meta.url));
    for (const file of migrations.filter(f => /^\d{14}_.*\.sql$/.test(f) && f.slice(0,14) >= '20261028000000').sort()) {
      await db.query(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
  } catch (error) {
    await db.end(); await control.query(`drop database ${name} with (force)`); await control.end(); throw error;
  }
  return { db, close: async () => { await db.end(); await control.query(`drop database ${name} with (force)`); await control.end(); } };
}
export async function asUser(db, userId, sql, values = []) {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    return await db.query(sql, values);
  } finally { await db.query('rollback'); }
}
export async function asRole(db, role, sql, values = []) {
  if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('Invalid fixture role');
  await db.query('begin');
  try { await db.query(`set local role ${role}`); return await db.query(sql, values); }
  finally { await db.query('rollback'); }
}
export const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222', wa: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', wb:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
export async function seedWorkspaces(db) {
  await db.query('insert into auth.users(id) values($1),($2)', [ids.a,ids.b]);
  await db.query("insert into public.workspaces(id,name,slug,owner_id) values($1,'Synthetic A','fixture-a',$2),($3,'Synthetic B','fixture-b',$4)",[ids.wa,ids.a,ids.wb,ids.b]);
}
