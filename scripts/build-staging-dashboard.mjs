import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePublicConfig} from '../dashboard/config.mjs';

export async function buildStagingDashboard(env = process.env, output = resolve('dist/staging-dashboard')) {
  const project_ref=env.PULSO_STAGING_PROJECT_REF;
  const config=validatePublicConfig({environment:'staging',project_ref,supabase_url:`https://${project_ref}.supabase.co`,publishable_key:env.PULSO_STAGING_PUBLISHABLE_KEY});
  const source=resolve(dirname(fileURLToPath(import.meta.url)),'../dashboard');
  await mkdir(output,{recursive:true});
  for (const file of ['index.html','app.mjs','config.mjs','metrics.mjs','auth.mjs','funnel.mjs']) await copyFile(resolve(source,file),resolve(output,file));
  await writeFile(resolve(output,'config.json'),JSON.stringify(config,null,2)+'\n');
  return {output,project_ref:config.project_ref,environment:config.environment};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result=await buildStagingDashboard();
    process.stdout.write(`Dashboard staging preparado: ${result.output} (${result.project_ref})\n`);
  } catch {
    process.stderr.write('Build bloqueado: configure somente PULSO_STAGING_PROJECT_REF e PULSO_STAGING_PUBLISHABLE_KEY válidos de um projeto isolado.\n');
    process.exitCode=1;
  }
}
