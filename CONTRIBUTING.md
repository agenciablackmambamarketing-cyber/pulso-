# Regras de alterações — Pulso Campanhas

- Usar repositório **privado**. Nunca commitar senhas, tokens OAuth, credenciais de pixel/CAPI, Hottok, eventos brutos com PII ou valores reais de variáveis secretas.
- Criar branches e pull requests para mudanças estruturais. Revisão obrigatória antes de deploy em produção.
- Não misturar produtos/contas pessoais e agência; workspace_id deve restringir toda consulta, associação e evento.
- Testar eventos duplicados, reembolso, webhook fora de ordem, perda de consentimento e vazamento cross-tenant.
- O painel da agência contratante não deve acessar dados pessoais do comprador nem hashes de correspondência, IP, user-agent ou tokens. Guardar só em backend privado com minimização e retenção.
- Pixel browser/server deve reutilizar `event_id` estável para deduplicação; `Purchase` só após aprovação do pedido, nunca por simples clique.
- Respeitar LGPD, escolhas de privacidade e condições Meta/Google/Taboola. Não buscar contornar mecanismos de consentimento.