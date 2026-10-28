# Staging — 28/10/2026

Ambiente criado com autorização do usuário na mesma organização do Pulso. A alternativa de branch foi recusada pelo Supabase: exige plano Pro. Não foi contratado upgrade. Um projeto independente foi criado sem solicitação de confirmação de custo pela ferramenta; isso não é uma garantia de gratuidade futura.

- Supabase: `pulso-campanhas-staging`, ref `osgumasejgumqlnqxcvm`, São Paulo, PostgreSQL17.11.
- Painel privado: https://pulso-campanhas-staging.fersthome.chatgpt.site
- Supabase dashboard: https://supabase.com/dashboard/project/osgumasejgumqlnqxcvm
- Baseline observado + quatro incrementos aplicados uma vez no banco novo. Não houve replay das 12 migrações de produção nem alteração do projeto de produção.
- Cinco Edge Functions publicadas: pulso-collect, hotmart-webhook, hotmart-connect, meta-connect, meta-worker.
- As funções Meta tiveram import de declaração de tipos JSR desnecessário removido após timeout de bundling; `deno task check` continua passando. Runtime segue com dependências npm fixadas.
- Painel sem URL/chave de produção embutidas. Configuração pública explícita; sem arquivo válido, Supabase não é inicializado.

## Verificações reais

O fluxo Auth + PostgREST hospedado foi testado com duas contas sintéticas temporárias, criadas no banco staging sem envio de e-mail. Login por senha e criação de workspace pela API passaram. Doze verificações adicionais constam em `backend-audit/staging-gateway-checks.json`: métricas próprias, isolamento de tenant, grants de colunas, acesso anônimo, RPC privilegiada, cadastro de site owner/admin e endpoints fail-closed. Tokens/senhas não foram salvos no repositório ou no relatório. Fixtures removidas; zero workspaces e vendas restantes.

62 testes Node passaram e cinco Edge Functions passaram no Deno. A CI da revisão anterior fa40a64 passou no GitHub; o resultado da revisão nova precisa ser conferido separadamente. Os 38 testes PostgreSQL da entrega anterior continuam como evidência anterior, não foram contados como execução nova sem rerun.

Security advisor: INFO em dez tabelas privadas com RLS e sem policies (deny-all intencional) e WARN de SECURITY DEFINER em `configure_tracking_site`, cuja verificação `auth.uid()` + owner/admin foi testada pelo gateway, inclusive negação cross-tenant. Remediação/referência: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable . Nenhum aviso deve ser interpretado como prova geral de ausência de vulnerabilidades.

## Configuração que ainda falta

A ferramenta Supabase conectada permite schema e deploy, mas não fornece uma operação para cadastrar Edge secrets; o ambiente executor não tem credencial Management API configurada. Não usar SQL para burlar esse limite nem colocar master keys no frontend. É necessário configurar, exclusivamente no projeto staging, em **Edge Functions → Secrets**:

- `PULSO_HANDOFF_HMAC_KEY`: segredo aleatório >=32 caracteres.
- `PULSO_RATE_HASH_KEY`: outro segredo independente.
- `PULSO_META_CREDENTIAL_KEY_V1`: base64 de32 bytes aleatórios.
- `PULSO_META_WORKER_SECRET`: segredo aleatório >=32 caracteres.
- `PULSO_ADMIN_ORIGINS` e `PULSO_DASHBOARD_ORIGINS`: `https://pulso-campanhas-staging.fersthome.chatgpt.site`.
- `META_GRAPH_VERSION`: versão suportada confirmada na documentação oficial Meta.
- `PULSO_TRUSTED_IP_HEADER`: deixar ausente; não habilitar sem verificar o ingress.

Não cole valores no chat. Use o gerenciador de segredos e mantenha backup seguro da chave AES. URL direta: https://supabase.com/dashboard/project/osgumasejgumqlnqxcvm/functions/secrets . Depois, criar usuário/workspace de teste no painel e cadastrar Hottok de teste + dataset/token CAPI/test_event_code nos formulários protegidos. O cadastro/login interativo e a confirmação de e-mail do usuário real ainda não foram verificados visualmente.

O coletor retorna503 enquanto faltar HMAC; o worker retorna401 sem segredo. Esse bloqueio foi verificado, não é entrega de conversão. Nenhum evento foi enviado à Meta/Hotmart nesta etapa. Nenhuma conta real de comprador foi utilizada. Meta permanece exclusivamente test-only.

Após configurar: registrar site/origem, executar o checklist `INGLES_DE_EMBARQUE_ACTIVATION.md`, provar echo sck em teste Hotmart e confirmar Purchase no Meta Test Events do dataset certo. Scheduler/retention, página real e conectores Google/Taboola permanecem pendentes. Não há autorização de produção implícita.
