# Verificação em 28/10/2026

Auditoria Supabase de produção somente leitura: 12 migrações e esquema/funções/grants/RLS registrados em backend-audit. Nenhum deploy ou conversão real.

Executados: npm test; PULSO_TEST_DATABASE_URL apontando PostgreSQL17.6 descartável npm run test:db; Deno2.9.6 task check (cinco Edge Functions). As suítes exercitam handlers Request/Response, criptografia, consentimento, limites, tenants, SQL real, grants, Hotmart, reversões, leases, retries e pipeline integrado com Meta simulada. Resultados finais constam na PR.

Não executados: navegação visual, gateway Auth/PostgREST hospedado, webhook real Hotmart, aceitação externa Meta Test Events ou campanha real. Sem credenciais/configuração staging; documentação oficial Meta retornou429, versão Graph atual requer conferência no release. CAPI permanece somente teste. Baseline é estrutural observado, não exportação de clientes nem histórico de migrações a reaplicar.
