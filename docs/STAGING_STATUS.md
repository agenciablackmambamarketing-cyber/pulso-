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

## Configuração interna concluída via Vault

Sete configurações de servidor foram provisionadas no Supabase Vault, sem revelar valores. As cinco funções consomem configuração completa de environment ou Vault; nenhum navegador pode ler o Vault ou executar a RPC de configuração. Ver [VAULT_RUNTIME.md](VAULT_RUNTIME.md) para escopo, migração, precedência, rotação e limitação de deploy futuro.

O coletor e hotmart-connect agora funcionam no staging. O teste hospedado usou uma fonte Hotmart sintética, requisições HTTP diretas e um produto sintético: PageView200, handoff assinado, cadastro autenticado da fonte200, compra aprovada200, repetição deduplicada, dashboard com uma compra atribuída de19,90 BRL, reembolso aceito, aprovação atrasada recusada, revogação aceita e replay negado403. Isso não prova que a Hotmart devolve sck em um checkout real, porque o provedor não originou essas chamadas. Não houve envio à Meta; nenhum destino CAPI estava cadastrado e a outbox ficou vazia.

Nesta revisão passaram71 testes Node,44 testes PostgreSQL local e Deno para cinco wrappers. A revisão independente testou permissões e escopo do Vault; não confundiu a view falsa local com criptografia real.

## Próxima ação necessária da agência

No [painel privado de staging](https://pulso-campanhas-staging.fersthome.chatgpt.site), criar/entrar na conta e criar workspace. Em Integrações, cadastrar:

1. Hottok de uma conexão de teste autorizada Hotmart; depois configurar webhook2.0 para o endpoint staging.
2. Pixel/Dataset ID autorizado, token CAPI e código Test Events da Meta, pelos campos protegidos.

Não cole credenciais no chat. As chaves internas de runtime não precisam mais ser cadastradas manualmente em Edge Secrets para este staging. Não configurar valores parciais em environment enquanto usa Vault.

Sem essas credenciais não é possível comprovar recepção externa, dedupe da Meta ou echo sck de checkout real. As fixtures sintéticas foram removidas: zero workspaces, vendas e fontes Hotmart; sete configurações de runtime preservadas. Evidência sanitizada em `backend-audit/staging-vault-pipeline-checks.json`. Nenhuma conversão real foi enviada. Scheduler/retention e fonte da página real permanecem pendentes. Produção inalterada e sem autorização implícita.
