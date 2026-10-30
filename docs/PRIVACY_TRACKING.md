# Dados e consentimento

| Fonte | Tratamento/destino | Retenção | Acesso |
|---|---|---|---|
| CMP | decisão, versão e timestamp no contexto privado | sessão 24h | backend |
| Página | UTMs, src/sck/xcod, click IDs em contexto privado | sessão 24h | backend |
| Ingress confiável | IP/UA consentidos; IP omitido sem proxy verificado | sessão 24h | backend |
| Hotmart | comprador validado; somente hashes necessários à CAPI | até expiração/revogação do contexto | backend |
| Hotmart | códigos de origem privados, sem payload bruto | 30 dias | backend |
| Outbox | identificadores removidos pelo cleanup/revogação inclusive após entrega | validade do contexto | backend |
| Dashboard | métricas, moeda, status e rótulos de campanha registrados | política financeira a definir | membros com RLS |

Hash não equivale a anonimização. Não há fingerprinting. Consentimento informado pelo CMP é evidência registrada, não prova independente de ação humana. Origem HTTP/chave pública não autenticam visitantes contra bots. A agência deve revisar aviso, finalidade e política LGPD antes da ativação.

A retirada de consentimento deve chamar revokeConsent; falha de rede mantém uma solicitação privada pendente para retry e bloqueia novos eventos locais. Um envio já em trânsito pode ter sido recebido; exclusão externa requer procedimentos próprios da plataforma. Agendar limpeza conforme DEPLOY_TRACKING.md; sem scheduler não há exclusão física automática. Solicitações de titulares exigem operador autorizado relacionar os identificadores disponíveis e eliminar contextos/handoffs/matching, mantendo somente registros com retenção legal justificada. Não fornecer buscas de comprador no dashboard.
