# Baseline observado — 28/10/2026

Este diretório é uma fotografia **somente de estrutura**, obtida por consultas aos catálogos do projeto `nlrhtioxsbncpluchfcz`. Nenhuma tabela de negócio foi consultada para exportar registros. Não contém clientes, payloads de vendas, tokens, hashes de compradores nem valores de credenciais.

`observed-2026-10-28.sql` serve para preparar **um banco isolado e vazio**, que já tenha os papéis Supabase (`anon`, `authenticated`, `service_role`) e a tabela/rotina de autenticação (`auth.users`, `auth.uid()`). Reconstitui as tabelas `public`/`private`, colunas, defaults, constraints, índices, RLS, políticas, funções, triggers, view e ACL observadas. A extensão `pgcrypto` é necessária. As extensões de infraestrutura (`vault`, `pg_stat_statements`, `uuid-ossp`) constam no JSON de auditoria e não são reinstaladas por esse bootstrap.

**Não é uma migração nova e não deve ser aplicada a produção.** Há uma guarda que recusa execução quando `public.workspaces` já existe. O SQL antigo em `supabase/migrations/20261025_pulso_core.sql` é parcial e histórico: não executar junto do baseline nem reaplicar ao banco existente. Não fabricamos 12 arquivos de migração equivalentes a partir de um estado final.

As 12 versões realmente executadas estão em `docs/backend-audit/applied-migrations.json`; os metadados completos estão em `schema-2026-10-28.json`. Para deploy incremental no banco existente, confirmar a lista remota e aplicar somente novas migrações revisadas. Para novo ambiente, primeiro provisionar Supabase Auth, carregar este baseline e depois as migrações novas; registrar/conciliar o histórico apenas após conferência humana, sem replay do SQL histórico.

`edge-functions/` guarda o código fonte implantado de `hotmart-webhook` v1 e `hotmart-connect` v2 para comparação com as versões editadas. Os arquivos em `supabase/functions/` são os candidatos ao próximo deploy; os desta pasta não são publicados automaticamente.

O baseline inclui as permissões observadas, inclusive lacunas de minimização que as migrações novas corrigem. Seu propósito é testar o avanço real a partir do estado existente, não declarar o estado antigo seguro para lançamento.
