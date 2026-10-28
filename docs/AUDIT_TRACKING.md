# Auditoria do backend Pulso — 28/10/2026

## Escopo e evidência

Inspeção somente leitura do projeto Supabase `pulso-campanhas` (`nlrhtioxsbncpluchfcz`, PostgreSQL 17.6), depois da leitura da issue #2, da PR #1 e dos dois documentos de requisitos. Nenhum deploy, migração, dado de teste ou conversão foi enviado ao ambiente remoto nesta auditoria. Foram consultados catálogos, definições SQL, permissões e fontes das Edge Functions; não exportamos registros de clientes nem conteúdo de tabelas privadas.

Artefatos versionados em `docs/backend-audit/`:

- `applied-migrations.json`: as **12** versões/nome efetivamente registradas no backend.
- `schema-2026-10-28.json`: 21 tabelas, colunas/defaults, constraints, índices, 29 políticas, 5 funções e uma view, triggers e ACL de tabelas/schemas/funções.
- `explicit-column-acls.json`: ACL por coluna obtida de `pg_attribute.attacl`. A seção `column_grants` de `schema-2026-10-28.json` deriva de `information_schema` e inclui permissões herdadas da tabela; não deve ser confundida com grants explícitos por coluna.
- `permission-checks.json`: verificações diretas `has_*_privilege`, sem leitura de dados.
- `deployed-functions.json` e `supabase/baseline/edge-functions/`: inventário e fontes implantadas para comparação.

O changelog atual do Supabase foi consultado; há mudança anunciada de cifras TLS em 10/11/2026. O código usa HTTPS com validação TLS padrão e não fixa cifras antigas. As orientações atuais de Auth/RLS e funções foram consultadas via documentação oficial.

## Divergência Git × backend

O único SQL histórico na branch original, `20261025_pulso_core.sql`, não representa todas as migrações aplicadas e pressupõe tabelas criadas antes dele. Seu nome não corresponde a uma das 12 versões remotas. Não é seguro executar `db push` indiscriminadamente a partir desse histórico.

O baseline em `supabase/baseline/observed-2026-10-28.sql` reconstitui o estado observado em um **novo banco isolado** com Supabase Auth já provisionado. Ele fica fora de `migrations/` e recusa execução se `workspaces` existir. Não fingimos reconstruir cada migração antiga nem inserimos histórico remoto artificial. Novas migrações devem avançar a partir desse estado, preservando dados e versões existentes.

Divergências de função relevantes:

- A função remota `register_hotmart_source` já cria/atualiza a integração Hotmart com estado `pending`; essa lógica não constava da versão SQL antiga no Git.
- O trigger `private.mark_hotmart_connected` marca `connected` somente após ingestão autenticada. Sua definição remota está no baseline.
- `hotmart-webhook` implantado é v1; `hotmart-connect` é v2. A lógica principal coincide com as fontes prévias do Git, com diferenças de formatação/log e checagem de erro. Os snapshots preservam exatamente as versões observadas; os arquivos ativos são candidatos ao próximo deploy.

## Segurança observada e lacunas

1. As **21 tabelas** em `public`/`private` têm RLS habilitada; nenhuma está sem RLS. `anon` não lê `sales`; `authenticated` não lê `sales.raw`.
2. As duas RPCs `SECURITY DEFINER` públicas (`ingest_hotmart_event`, `register_hotmart_source`) são executáveis apenas por `service_role`, não por `anon`/`authenticated`. As três funções privadas de trigger não têm grant público. Search paths são explícitos. Não foi observado uso de metadados editáveis de usuário para decisões de autorização.
3. `private` não concede `USAGE` a `anon`, `authenticated` **nem** a `service_role`. Os acessos internos atuais são feitos pelas RPCs privilegiadas. Novos acessos backend devem usar RPCs mínimas e explícitas ou grants revisados, não presumir que chave de serviço implica schema exposto na API.
4. Há FKs compostas anti-cross-tenant em conta, campanha, métricas, atribuição, sessão, ledger, destino, contexto privado e outbox; há vínculo de provider entre integração e destino e entre destino e evento. RLS deve ser testada com papéis reais e dois workspaces; presença de FK/RLS isoladamente não prova o fluxo inteiro seguro.
5. **Lacuna de minimização:** `tracking_sessions` concede `SELECT` de todas as colunas a membros, incluindo `fbclid/gclid/tblci/gbraid/wbraid/public_session_id`; `sales` concede leitura explícita de `src/sck/xcod`. A migração nova precisa restringir esses identificadores e disponibilizar métricas seguras. Não basta deixar de selecioná-los na UI: os grants também devem mudar.
6. `conversion_destinations` aceita escrita direta de administradores autenticados por RLS. O worker não pode confiar somente em `is_active` configurado pelo cliente; credencial/destino testados devem permanecer vinculados no backend.
7. Ingestão antiga já usa Hottok SHA-256, lock por workspace/transação, dedupe por evento e proteção de estados terminais. Ainda faltavam handoff verificado, fila CAPI, validação estrita tipo/status e proteção consistente de eventos terminais fora de ordem. O IP do webhook jamais pode substituir o IP da visita.
8. O Security Advisor retornou somente o informativo `rls_enabled_no_policy` para as cinco tabelas privadas: `hotmart_sources`, `integration_credentials`, `visitor_match_context`, `conversion_event_outbox`, `webhook_events`. Nesse desenho a ausência de policy é deny-all, combinada com revogação de schema. Não adicionamos uma policy permissiva apenas para silenciar esse aviso. [Referência do advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## O que esta auditoria não comprova

Não valida uma conta Hotmart conectada, posse de dataset Meta, credenciais CAPI válidas, acesso de navegador ao dashboard ou entrega externa de eventos. Não executou código de ingestão em produção. Os testes SQL/HTTP locais devem usar este baseline e as novas migrações; seus resultados são documentados no relatório da entrega, com a distinção entre simulação e Test Events externos.

## Revisão da PR #1

A PR #1 é draft, aberta sobre `main`; a branch de entrega parte do head dela para preservar o SDK existente. Seus cinco testes unitários cobrem consentimento inicial, allowlist de parâmetros, preservação de `sck`, bloqueio após revogação e rejeição de evento `purchase` no browser. Eles não fazem chamadas externas nem demonstram segurança de banco ou entrega CAPI.

Pontos identificados antes da continuação:

- SDK original não enviava evidência de consentimento (versão/timestamp/base legal) ao coletor; apenas executava callback local.
- Não havia TTL de sessão, continuidade assinada de sessão ou expiração verificada do token; o browser aceitava qualquer string com regex de comprimento.
- `sck` e `xcod` de entrada ainda não estavam na allowlist. Não havia observação de `checkout_started`; um clique isolado não deve virar `InitiateCheckout`.
- Os testes usavam sempre o mesmo UUID para sessão/evento, insuficiente para testar dedupe real, replay e colisões.
- Revogação bloqueava novas chamadas locais, mas não revogava contexto já enviado ao backend; outbox precisa rever permissão atual antes do envio.
- Storage indisponível, rejeição de fetch e respostas inválidas precisam falhar com segurança sem impedir acesso ao checkout.
- Faltavam todos os testes de origem/payload/taxa, assinatura adulterada/expirada, dois tenants, autenticação administrativa, restrições SQL efetivas, Hotmart concorrente/fora de ordem e retries CAPI.

A ausência dessas partes está declarada no corpo da própria PR. A entrega nova deve demonstrá-las com testes separados e não reapresentar os cinco testes anteriores como prova de integração.
