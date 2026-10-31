# Reconstrução isolada do Pulso — 31/10/2026

Foi criado o projeto Supabase **pulso-reconstrucao** (`utmfnskpfyykkakmxkcn`) na organização `agenciablackmambamarketing-cyber's Org`, região São Paulo (`sa-east-1`). Ele é um ambiente novo, sem cópia dos dados históricos. Os projetos históricos não estavam acessíveis por esta conexão; isso não prova que tenham sido apagados. Nenhuma alteração foi feita neles.

O painel de testes é privado e restrito ao proprietário do Site: https://pulso-reconstrucao-2026.fernychick.chatgpt.site. Seu código está em um repositório próprio do Site; usa apenas a URL e a chave publicável do novo Supabase. O acesso autenticado ao painel e a confirmação de e-mail ainda não foram testados de ponta a ponta.

## O que está instalado

- Baseline e os sete incrementos P0 aplicados como uma única migração ao banco vazio: workspaces, membros, contas, campanhas, vendas, funil, atribuições, financeiro, dados de configuração e operações das integrações.
- 33 tabelas em `public` e `private`, todas com RLS. Dados de credenciais e identificadores privados continuam bloqueados para `anon` e `authenticated`.
- Seis Edge Functions ativas: `pulso-collect`, `hotmart-webhook`, `hotmart-connect`, `meta-connect`, `meta-ads` e `meta-worker`. A autenticação própria de cada endpoint está preservada; nenhuma credencial de cliente foi cadastrada.
- Sete configurações de runtime foram criadas no Vault do novo projeto; chaves aleatórias foram geradas no banco e não foram retornadas para chat, Git ou painel.
- O agendamento `pulso-retention-hourly` está ativo e registrou execução bem-sucedida. O acionamento automático `pulso-meta-test-worker` está **desativado**; o worker de Meta também só aceita eventos de teste.

## Histórico e reprodução

As cinco migrações aplicadas foram registradas no Supabase e estão copiadas byte a byte em `fresh-install/supabase/migrations/`, com os mesmos identificadores do banco. O diretório é uma área CLI separada: as migrações históricas de `supabase/migrations` não devem ser combinadas com esse bootstrap. Nunca use `db push` ou `db reset` no ambiente histórico para sincronizar esta reconstrução.

O histórico é específico deste projeto. A migração do agendamento contém a URL do novo worker, portanto não deve ser aplicada sem adaptação a outro projeto. Como acontece com qualquer migração histórica, não a reaplique em banco existente. O utilitário `node scripts/plan-fresh-database.mjs` continua sendo apenas um plano de leitura, não instala ou altera o banco.

## Verificação

- `npm test`: 149 testes passaram.
- Testes transacionais com dois usuários e workspaces sintéticos verificaram isolamento, acesso a dados privados, autorização de configuração, colisão de chaves de site, Hottok inválido, deduplicação, reembolso, eventos fora de ordem e separação de transações por workspace. Fixtures foram revertidas e não restaram workspaces sintéticos.
- Teste transacional de Meta Ads verificou isolamento, ROI positivo/zero/negativo, gasto zero e cobertura incompleta, estornos e moeda. Nenhuma chamada real à Meta foi feita.
- O acesso anônimo à configuração de tracking, às métricas e às credenciais foi negado; os endpoints HTTP responderam com a proteção esperada a chamadas sem autenticação.

## Pendências antes de uso real

1. Confirmar a configuração de URLs do Supabase Auth para o endereço exato do painel e testar cadastro, e-mail de confirmação e login. O fluxo autenticado do painel não foi validado neste navegador.
2. Entrar no painel, criar o workspace e cadastrar o Hottok apenas no campo protegido. Configurar na Hotmart o webhook apontando para o endereço exibido no painel e testar um evento oficial. Nenhuma venda real foi recebida nesta reconstrução.
3. Conectar uma conta Meta Ads com permissão de leitura e comparar os valores reais. A Meta CAPI está restrita a Test Events; Google Ads e Taboola não possuem conectores ativos nesta entrega.
4. A extensão `pg_net` veio com permissões herdadas que não foram removidas pelas revogações disponíveis para o papel `postgres`; o Security Advisor também a sinaliza em `public`. A fila automática foi desativada, não há solicitações ou eventos na fila e nenhum segredo foi enviado por ela. Revisar permissões/arquitetura antes de reativá-la. A migração de revogação é preservada no histórico por fidelidade, mas não deve ser considerada uma correção comprovada.
5. Registrar o domínio de cada página e a política de consentimento antes de ativar o coletor; conferir o fluxo completo da página até o checkout e a compra. A mera existência das tabelas não comprova integração ou atribuição reais.
