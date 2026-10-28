import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isolatedDatabase, asRole } from './helpers.mjs';

// This fake view tests PostgreSQL scope/permissions only. It does not simulate
// Vault encryption, keys, backups, cryptographic guarantees or hosted behavior.
const componentKeys = {
  collector: ['PULSO_HANDOFF_HMAC_KEY','PULSO_RATE_HASH_KEY'],
  webhook: ['PULSO_HANDOFF_HMAC_KEY'],
  hotmart_connect: ['PULSO_DASHBOARD_ORIGINS'],
  meta_connect: ['PULSO_ADMIN_ORIGINS','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION'],
  meta_worker: ['PULSO_META_WORKER_SECRET','PULSO_META_CREDENTIAL_KEY_V1','META_GRAPH_VERSION'],
};

test('runtime Vault boundary grants only server callers fixed per-component settings',async t=>{
  const fixture=await isolatedDatabase();const {db}=fixture;t.after(()=>fixture.close());
  await t.test('public roles cannot execute the secret-bearing RPC or read private refs',async()=>{
    for(const role of ['anon','authenticated']){
      await assert.rejects(asRole(db,role,"select public.pulso_runtime_config('collector')"),error=>error.code==='42501');
      await assert.rejects(asRole(db,role,'select * from private.pulso_runtime_secret_refs'),error=>error.code==='42501');
    }
    const {rows:[fn]}=await db.query("select prosecdef,exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute,has_function_privilege('service_role',oid,'execute') as server_execute from pg_proc where oid='public.pulso_runtime_config(text)'::regprocedure");
    assert.equal(fn.prosecdef,true);assert.equal(fn.public_execute,false);assert.equal(fn.server_execute,true);
  });
  await t.test('missing Vault fails closed without broad schema reads',async()=>{
    try {
      const {rows:[row]}=await asRole(db,'service_role',"select public.pulso_runtime_config('collector') as config");
      assert.ok(!row.config || !row.config.PULSO_HANDOFF_HMAC_KEY);
    }catch(error){assert.ok(!error.message.includes('decrypted_secret'));}
  });
  await db.query('create schema vault; create table vault.test_secrets(id uuid primary key,name text,decrypted_secret text); create view vault.decrypted_secrets as select id,name,decrypted_secret from vault.test_secrets');
  const allKeys=[...new Set(Object.values(componentKeys).flat())];
  for(const name of allKeys){
    const id=randomUUID();
    await db.query('insert into vault.test_secrets(id,name,decrypted_secret) values($1,$2,$3)',[id,name,'synthetic-value-for-'+name]);
    await db.query('insert into private.pulso_runtime_secret_refs(setting_name,vault_secret_id) values($1,$2)',[name,id]);
  }
  const unrelatedId=randomUUID();
  await db.query('insert into vault.test_secrets(id,name,decrypted_secret) values($1,$2,$3)',[unrelatedId,'UNRELATED_OPERATOR_SECRET','unrelated-synthetic-secret-never-return']);
  await assert.rejects(db.query('insert into private.pulso_runtime_secret_refs(setting_name,vault_secret_id) values($1,$2)',['UNRELATED_OPERATOR_SECRET',unrelatedId]),error=>error.code==='23514');
  await t.test('server components receive exactly their allowlisted values',async()=>{
    for(const [component,allowed] of Object.entries(componentKeys)){
      const {rows:[row]}=await asRole(db,'service_role','select public.pulso_runtime_config($1) as config',[component]);
      assert.deepEqual(Object.keys(row.config).sort(),[...allowed].sort(),component);
      for(const key of allowed)assert.equal(row.config[key],'synthetic-value-for-'+key);
      assert.ok(!JSON.stringify(row.config).includes('unrelated-synthetic-secret-never-return'));
    }
  });
  await t.test('dangling or incomplete references fail atomically without partial secret response',async()=>{
    await db.query("update private.pulso_runtime_secret_refs set vault_secret_id=$1 where setting_name='PULSO_RATE_HASH_KEY'",[randomUUID()]);
    await assert.rejects(asRole(db,'service_role',"select public.pulso_runtime_config('collector')"),error=>error.code==='55000' && !error.message.includes('synthetic-value'));
    const {rows:[row]}=await asRole(db,'service_role',"select public.pulso_runtime_config('webhook') as config");
    assert.deepEqual(Object.keys(row.config),['PULSO_HANDOFF_HMAC_KEY']);
  });
  await t.test('arbitrary secret names or SQL-like component values cannot retrieve secrets',async()=>{
    for(const invalid of ['UNRELATED_OPERATOR_SECRET','__proto__',"collector'); select decrypted_secret from vault.decrypted_secrets;--",'']){
      try{
        const {rows:[row]}=await asRole(db,'service_role','select public.pulso_runtime_config($1) as config',[invalid]);
        assert.ok(!row.config || Object.keys(row.config).length===0);
      }catch(error){assert.ok(!error.message.includes('unrelated-synthetic-secret-never-return'));}
    }
  });
});
