import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This plans a new isolated environment; it does not connect to or change a database.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const protectedRefs = new Set(['nlrhtioxsbncpluchfcz', 'osgumasejgumqlnqxcvm']);
const orderedFiles = Object.freeze([
  'supabase/baseline/observed-2026-10-28.sql',
  'supabase/migrations/20261028010017_pulso_meta_delivery.sql',
  'supabase/migrations/20261028010034_pulso_first_party_collector.sql',
  'supabase/migrations/20261028010038_hotmart_authenticated_tracking_v2.sql',
  'supabase/migrations/20261028010125_pulso_safe_dashboard_metrics.sql',
  'supabase/migrations/20261028091816_pulso_vault_runtime_config.sql',
  'supabase/migrations/20261029023643_pulso_ordered_session_funnel.sql',
  'supabase/migrations/20261029124537_pulso_meta_ads_read_cache.sql',
]);

export async function planFreshDatabase({ projectRef, root = sourceRoot } = {}) {
  if (projectRef !== undefined && (!/^[a-z]{20}$/.test(projectRef) || protectedRefs.has(projectRef))) {
    throw new Error('A referência deve apontar para um novo projeto isolado, diferente dos ambientes históricos.');
  }
  const files = [];
  for (const path of orderedFiles) {
    const content = await readFile(resolve(root, path));
    if (content.length === 0) throw new Error(`Arquivo vazio: ${path}`);
    if (files.length === 0 && !content.toString('utf8').includes("to_regclass('public.workspaces')")) {
      throw new Error('O baseline não tem a verificação esperada de banco vazio.');
    }
    files.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return {
    target: projectRef ?? null,
    database_changed: false,
    scope: 'isolated_new_project_only',
    notice: 'Plano local; confirme projeto vazio, dependências, ACLs e custos antes de aplicar.',
    files,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !args[0].startsWith('--project-ref='))) {
    process.stderr.write('Uso: node scripts/plan-fresh-database.mjs [--project-ref=NOVO_PROJETO]\n');
    process.exitCode = 1;
  } else {
    try {
      const projectRef = args.length ? args[0].slice('--project-ref='.length) : undefined;
      process.stdout.write(JSON.stringify(await planFreshDatabase({ projectRef }), null, 2) + '\n');
    } catch (error) {
      process.stderr.write(`Plano bloqueado: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
