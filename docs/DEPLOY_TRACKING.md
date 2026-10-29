# Deploy controlado — staging antes de produção

## Estado desta entrega

Nenhum SQL ou função desta branch foi aplicado em produção. Em 28/10/2026, baseline e quatro incrementos foram aplicados somente ao staging osgumasejgumqlnqxcvm; cinco Edge Functions estão ativas lá, ainda sem segredos de coleta/envio. Ver STAGING_STATUS.md. As duas funções Hotmart existentes continuam como auditadas. A CAPI nova é **somente de teste**, inclusive no backend: `pulso_meta_save` recusa modo diferente de `test` e o worker recusa jobs de produção. Um release de produção exigirá implementação/revisão do gate de ativação e autorização separada; não há uma variável que habilite envios reais por acidente.

## Banco e histórico

1. Criar/selecionar um projeto Supabase **staging isolado**, sem consumidores reais e sem cadastrar o webhook de contas de vendas reais. Nenhum staging foi criado automaticamente nesta tarefa.
2. Em staging vazio, provisionar Auth/roles padrões Supabase e executar `supabase/baseline/observed-2026-10-28.sql`. Ele recusa banco com `public.workspaces`. `tests/database/auth-bootstrap.sql` é só para PostgreSQL local, **nunca Supabase hospedado**.
3. Em staging equivalente ao backend existente, comparar snapshot/catálogo à auditoria e não executar o baseline.
4. Aplicar, uma vez, nesta ordem e em transação individual por arquivo, com credenciais somente no gerenciador do ambiente/SQL editor:
   - `20261028010017_pulso_meta_delivery.sql`
   - `20261028010034_pulso_first_party_collector.sql`
   - `20261028010038_hotmart_authenticated_tracking_v2.sql`
   - `20261028010125_pulso_safe_dashboard_metrics.sql`
   - `20261028091816_pulso_vault_runtime_config.sql` (necessário para usar o fallback Vault deste staging)
   - `20261029023643_pulso_ordered_session_funnel.sql` (aba Funil; não concede acesso a identificadores)
5. Registrar cada nova migração pelo fluxo de release revisado do ambiente. Não inventar arquivos antigos nem marcar histórico como aplicado sem comparação. Os arquivos novos não são scripts para reaplicar livremente: constraints, triggers e políticas já existentes devem ser verificados antes de qualquer retry.
6. Confirmar RLS, grants de colunas e ACLs de funções com as consultas da auditoria. Nenhuma tabela privada deve ficar acessível a anon/authenticated; `sales.raw`, origens, IDs, matching e payloads não podem ser selecionados pelo dashboard.

## Configuração Edge

**Atualização de staging:** as sete configurações de runtime foram provisionadas via Supabase Vault, com RPC apenas service_role e escopos fixos. Consulte VAULT_RUNTIME.md. Environment completo continua suportado, mas preenchimento parcial é recusado; não misture fontes. Essa migração e os wrappers novos não foram aplicados em produção.

Lista de nomes em `.env.example`. O runtime normalmente fornece `SUPABASE_URL` e `SUPABASE_SECRET_KEYS`/`SUPABASE_SERVICE_ROLE_KEY`, e publicáveis para `getUser` (`SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_ANON_KEY`). **Secret/service_role jamais no dashboard**.

Configurar por projeto via Supabase secret management, sem valores em argumentos de shell, Git, logs ou chat:

| Nome | Uso |
|---|---|
| `PULSO_HANDOFF_HMAC_KEY` | HMAC do handoff, >=32 caracteres aleatórios; compartilhar entre coletor e webhook |
| `PULSO_RATE_HASH_KEY` | Segredo independente para rate-limit sem guardar IP cru nos buckets |
| `PULSO_META_CREDENTIAL_KEY_V1` | Base64 de 32 bytes aleatórios para AES-GCM; backup/rotação controlados |
| `PULSO_META_WORKER_SECRET` | >=32 caracteres; autenticação exclusiva do job |
| `META_GRAPH_VERSION` | Versão explicitamente suportada e revisada na documentação oficial Meta |
| `PULSO_ADMIN_ORIGINS` | Origens HTTPS exatas permitidas no `meta-connect` |
| `PULSO_DASHBOARD_ORIGINS` | Origens HTTPS exatas permitidas no `hotmart-connect` |
| `PULSO_TRUSTED_IP_HEADER` | Opcional; vazio não retém IP. Somente `cf-connecting-ip`/`x-real-ip` após provar que ingress remove cabeçalho arbitrário e injeta o próprio |

Não usar `x-forwarded-for` arbitrário. Sem proxy confiável, o rate-limit por site continua ativo, IP não é usado para correspondência. Origem e chave pública não autenticam humanos; aplicar WAF/limites de infraestrutura conforme tráfego e revisar proteção contra automação antes do público amplo.

CLI usada para gerar arquivos: Supabase 2.122.0 (`SUPABASE_HOME` pode apontar a um diretório gravável; não alterar HOME). Consultar `--help` da CLI instalada antes do release. Exemplo de deploy **somente depois de completar as etapas em staging**, substituindo a referência por staging confirmado:

```sh
supabase functions deploy pulso-collect --project-ref STAGING_PROJECT_REF
supabase functions deploy hotmart-webhook --project-ref STAGING_PROJECT_REF
supabase functions deploy hotmart-connect --project-ref STAGING_PROJECT_REF
supabase functions deploy meta-connect --project-ref STAGING_PROJECT_REF
supabase functions deploy meta-worker --project-ref STAGING_PROJECT_REF
```

`supabase/config.toml` declara `verify_jwt=false` porque cada endpoint aplica a própria autenticação: Hottok, getUser+papel ou segredo do worker. Isso não autoriza retirar os checks do código. O coletor é público com limites específicos. Dependências runtime fixadas em versões e lockfile.

## Dashboard, sites e credenciais

- A aba Funil usa a RPC `pulso_dashboard_funnel` e agrega sessões em sequência, não totais independentes de eventos. Aplicar o incremento correspondente antes de publicar a UI. Ver [FUNNEL.md](FUNNEL.md) para definições, limites de medição e checklist da página. A migração do funil foi gerada com CLI2.81.3 após validar o checksum oficial do binário; não exige alteração do runtime das Edge Functions.
- O painel agora carrega `dashboard/config.json` público explícito e não inicializa Supabase se a configuração faltar ou for inválida. Gere a cópia isolada com `PULSO_STAGING_PROJECT_REF` e `PULSO_STAGING_PUBLISHABLE_KEY` executando `node scripts/build-staging-dashboard.mjs`. O build de staging recusa o projeto conhecido de produção. Nenhum segredo pode ser incluído nesse JSON; a cópia gerada fica em `dist/staging-dashboard`.
- Entrar/criar conta, criar workspace staging. Hottok no formulário Hotmart; Meta dataset/token/test_event_code no formulário Meta. `GET dataset?fields=id` confirma acesso/identidade, **não comprova permissão de envio CAPI**: Test Events é obrigatório.
- Como owner/admin do workspace, executar via cliente Auth a RPC `configure_tracking_site` com `p_workspace_id`, `p_site_key`, `p_allowed_origins` HTTPS exatos, `p_consent_policy_version`. Não registrar origem de outro cliente e não aceitar wildcard.
- Versionar previamente uma campanha/conta sintética autorizada em staging se for testar `utm_campaign`: esta versão só transforma IDs externos de campanhas registradas em rótulos públicos; UTMs brutos ficam privados.
- O formulário desativar/revogar remove elegibilidade de envio; reativação exige salvar/testar credencial novamente. A RPC de reprocessamento é owner/admin via `meta-connect` com `action=reprocess`, `destination_ref`, `outbox_id`; UI não oferece editor de payload. Nunca alterar event_id para "resolver" retry.

## Jobs e retenção

Agendar em infraestrutura backend autorizada:

- Invocação POST `meta-worker` com `x-pulso-worker-secret` backend. Cada chamada processa no máximo um job; frequência/concorrência devem corresponder ao volume. Não guardar o segredo em página, URL, crontab público ou logs.
- `select public.pulso_retention_cleanup();` em job privilegiado pelo menos de hora em hora. Limpa matching expirado da outbox, contextos expirados, handoffs e buckets antigos, preservando métricas não pessoais.
- `select public.pulso_purge_hotmart_context();` diariamente para códigos de origem privados com TTL de 30 dias.
- Alertar sobre pendentes antigos, `attempts_exhausted`, `meta_auth`, `meta_rejected`, falta de matching e aumento de não atribuídas. `accepted` significa resposta API, não ROAS ou atribuição.

O agendamento não foi criado nesta tarefa. Sem ele, retenção física/retry não ocorrem automaticamente. A elegibilidade é checada por validade/consentimento antes do envio, mesmo entre execuções de limpeza.

## Rollback e compatibilidade

1. Desativar site/retirar SDK das páginas e parar worker/scheduler; revogar ou desativar destino pelo endpoint autorizado.
2. Preservar o banco e os dados; não executar DROP de tabelas/colunas nem `db reset`.
3. Reverter dashboard e Edge Functions para a versão anterior revisada, usando snapshots em `supabase/baseline/edge-functions` como comparação. A RPC legada `ingest_hotmart_event(text,jsonb)` permanece e delega para a ingestão nova sem confiar em handoff não verificado.
4. Manter grants mais restritos. Caso uma versão antiga do dashboard selecione campos revogados, corrigir a UI para não acessá-los; não restaurar vazamento para fazer rollback.
5. Correções de SQL por migração forward-only revisada. Não reexecutar histórico antigo. Restaurar AES master key somente via mecanismo de segredos; trocar chave sem recriptografar/reconectar invalida credenciais antigas.

## Fontes consultadas

Supabase changelog e docs atuais: https://supabase.com/changelog.md e https://supabase.com/docs/guides/functions/auth . Meta oficial: https://developers.facebook.com/docs/marketing-api/conversions-api/ (acesso retornou 429 nesta sessão; não se afirma verificação da versão Graph mais nova). Hotmart: https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/purchase-webhook/ . Confirmar compatibilidade `sck`/echo no checkout real em staging antes de qualquer ativação.
