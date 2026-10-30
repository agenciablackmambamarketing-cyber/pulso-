# Staging — histórico e estado em 30/10/2026

## Atualização — campanhas, gastos e ROI de mídia

Implementação concluída na branch: leitura server-side Meta Ads, credenciais cifradas por workspace/conta, sincronização atômica, campanhas ativas, gastos incluindo campanhas pausadas e ROI de mídia positivo em verde/negativo em vermelho. Receita considera todas as plataformas de venda registradas, com escopo de mídia Meta explícito; Google/Taboola e outras fontes dependem de conectores. Lucro líquido e ROI líquido continuam indisponíveis sem custos conciliados. Ver [CAMPAIGNS_ROI.md](CAMPAIGNS_ROI.md).

Validação local nesta revisão:146 testes Node e60 testes PostgreSQL passaram; Deno2.9.6 validou seis wrappers. As respostas Graph são simuladas: nenhuma conta Meta real foi consultada e nenhuma conversão foi enviada.

**Publicado no staging em30/10/2026:** o erro anterior da ferramenta foi resolvido. Após conferir catálogo e histórico, o incremento foi aplicado uma vez como `20261030071853_pulso_meta_ads_read_cache`; não houve replay do baseline ou das migrações antigas. `meta-ads` está ACTIVE v1 e o painel privado está na versão6, source `cfa6e5ec4293d28b45ac9d22a33af6dda0921736`, com código funcional da branch `9c5e3b4`. A origem permanece restrita ao proprietário; produção e Netlify original não foram alterados.

O teste transacional no PostgreSQL hospedado confirmou ROI+200%/0%/−100%, gasto zero e cobertura incompleta como indisponíveis, receita de duas fontes, reversões excluídas, gasto pausado incluído, isolamento entre tenants e negação de credenciais privadas/mutações privilegiadas. Rollback integral: zero workspaces de teste remanescentes. HTTP `meta-ads`: preflight204, sem login401, bearer inválido401, origem errada403. Sete arquivos hospedados retornaram200 e SHA idêntico ao source enviado, incluindo a cópia de teste preservada. Não houve QA visual/autenticado em navegador; ferramenta indisponível. Evidência e SQL reexecutável em `backend-audit/staging-ads-release-2026-10-30.json` e `backend-audit/staging-ads-smoke-2026-10-30.sql`.

O security advisor manteve dois avisos anteriores (guarda de `configure_tracking_site` e proteção de senhas vazadas desativada), sem novo aviso de definer público. As quatro tabelas privadas novas têm RLS sem policies, deny-all intencional, e nenhuma permissão de leitura de credenciais para clientes. A CI do código `9c5e3b4` passou: https://github.com/agenciablackmambamarketing-cyber/pulso-/actions/runs/40947972736 . A evidência de29/10 preserva o bloqueio histórico daquele dia.

Permanece pendente conectar uma conta de anúncios com `ads_read` pelo campo protegido e comparar dados reais no mesmo fuso/moeda/período. O teste oficial Hotmart depende de acesso autenticado à conta; Test Events CAPI e scheduler também permanecem pendentes. Não declarar retorno real a partir dos testes locais.

## Atualização — funil de sessões

**Teste manual confirmado no backend em29/10/2026:**1 visita,1 visualização da oferta e4 cliques recebidos na mesma sessão consentida da cópia privada. O funil deduplicado é1→1→1; checkout aberto não medido. Zero vendas/outbox Meta. Hotmart ainda pendente do teste oficial. Ver `backend-audit/ingles-preview-manual-2026-10-29.json`. A navegação foi feita pelo usuário; o agente verificou agregados do backend sem inspecionar o navegador.

**Página fornecida e cópia de teste preparada:** https://ingles-de-embarque-black-mamba.netlify.app/ está no Netlify com deploy manual. A cópia privada foi instrumentada no caminho `/teste-ingles-de-embarque/` do painel, sem alterar esse deploy. O site first-party foi registrado apenas no staging e passou por checagens de origem/consentimento. Ver [INGLES_DE_EMBARQUE_PREVIEW.md](INGLES_DE_EMBARQUE_PREVIEW.md) para navegação, procedência, eventos e limitações.103 testes Node passaram nesta revisão. O painel identifica visivelmente o ambiente de testes.

Aplicado apenas no staging o incremento `20261029023643_pulso_ordered_session_funnel.sql`: agrega sessões em sequência sem conceder acesso a identificadores. O painel ganhou aba Funil, taxas por etapa, maior queda em volume, filtros Hoje/7/30 dias e tratamento explícito de checkout sem confirmação. Definições e limites em [FUNNEL.md](FUNNEL.md).

Validação desta revisão:87 testes Node e49 testes PostgreSQL local passaram. No PostgreSQL hospedado do staging, uma fixture sintética dentro de transação confirmou contagem1→1→1→1 apesar de PageView repetido, negação cross-workspace, negação de anônimo e preservação dos grants restritos; houve rollback integral e zero fixtures remanescentes. A chamada PostgREST sem login retornou401/42501. Isso verifica banco e gateway anônimo, não substitui QA visual/autenticado no navegador. Controle de navegador indisponível nesta sessão.

Estado observado antes da navegação manual: existe workspace da agência com uma fonte Hotmart ativa/salva, ainda sem eventos recebidos, sessões ou eventos do funil, e um site de coleta da cópia privada. Os trechos históricos abaixo que dizem zero workspaces/fontes referem-se à limpeza das fixtures anteriores. Nenhuma credencial da agência foi alterada; a única configuração adicional é a origem/site de coleta do laboratório. A página original de produção permanece inalterada e nenhuma conversão real foi enviada.

O security advisor manteve os avisos anteriores: tabelas privadas com deny-all intencional, `configure_tracking_site` com guarda owner/admin e proteção de senhas vazadas desativada. A função nova não criou aviso de definer público. Referências: [funções](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) e [senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Histórico — provisionamento em 28/10/2026

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
