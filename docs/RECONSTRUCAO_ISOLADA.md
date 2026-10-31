# Preparação de um novo banco isolado para o Pulso

Em 31/10/2026 a conexão Supabase desta sessão retornou uma organização sem projetos visíveis e negou acesso às referências históricas `nlrhtioxsbncpluchfcz` e `osgumasejgumqlnqxcvm`. A ausência de permissão não prova exclusão nem perda de dados. O código completo mais recente recuperado está na PR #3, ainda em rascunho.

## Plano somente de leitura

```sh
node scripts/plan-fresh-database.mjs
# Após criar um projeto isolado, sem preencher dados sensíveis:
node scripts/plan-fresh-database.mjs --project-ref=REFERENCIA_DO_NOVO_PROJETO
```

O comando confere a presença do baseline e dos sete incrementos na ordem documentada, e mostra seus hashes SHA-256 para revisão. Ele não verifica o banco remoto, não aplica SQL e não altera projetos. A referência opcional rejeita os dois ambientes históricos; um identificador válido não prova que o banco esteja vazio nem que a pessoa tenha permissão de usá-lo.

## Sequência após a seleção da organização

1. Confirmar custo/limites do novo projeto quando o provedor solicitar; criar apenas depois da escolha da organização e da aprovação de qualquer custo não zero.
2. Confirmar projeto, região e esquema vazio; revisar `supabase/baseline/README.md` e `docs/DEPLOY_TRACKING.md`. Não executar a migração histórica parcial nem carregar fixtures locais no Supabase hospedado.
3. Revisar baseline, incrementos, autenticação, permissões e dependência de Vault. Aplicar somente no novo ambiente, na ordem revisada; conferir catálogo, RLS, grants, histórico e logs antes de retentar qualquer erro.
4. Validar em ambiente de teste usuários de workspaces separados, webhook repetido e fora de ordem, reembolso, consentimento, isolamento e remoção de fixtures. Ativar coleta e integrações somente após a configuração necessária e teste autorizado.
5. Configurar Edge Functions, secrets em backend/Vault e dashboard usando exclusivamente a URL e a chave publicável do novo projeto. Não inserir credenciais reais em chat, arquivos do repositório ou interface pública.

Não há banco novo criado ou SQL aplicado por este plano. O histórico do repositório relata um staging anterior, mas ele não pôde ser inspecionado nesta sessão. As integrações com Hotmart e Meta exigem configuração e validação externas; Google Ads e Taboola seguem pendentes.
