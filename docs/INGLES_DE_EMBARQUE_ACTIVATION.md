# Inglês de Embarque — checklist de ativação

## Staging e teste externo pendentes

- [x] Provisionar Supabase staging isolado e aplicar baseline/incrementos de tracking, Vault e funil conforme DEPLOY_TRACKING.md.
- [x] Configurar runtime interno, origens exatas e versão Graph de teste via Vault.
- [x] Apontar cópia staging do dashboard para URL/chave publicável staging.
- [x] Validar acesso cruzado com duas contas sintéticas via Auth/PostgREST hospedado; fixtures removidas.
- [ ] Registrar origem/site e campanha autorizada do Inglês de Embarque.
- [ ] Cadastrar Hottok pelo painel; configurar Hotmart Webhook V2 no endpoint staging.
- [ ] Cadastrar dataset/token/test_event_code Meta pelo painel; verificar dataset correto.
- [ ] Integrar tracker/examples/ingles-de-embarque.html em cópia da página, com CMP real e versão de consentimento correspondente.
- [ ] Rejeitar marketing: nenhum evento ou ID publicitário; aceitar: PageView e ViewContent; clique não pode ser contado como checkout iniciado sem observação real.
- [ ] Validar link externo preservando afiliado/oferta/sck existente; conferir echo do handoff no webhook. Checkout Elements permanece sujeito à validação específica do integrador.
- [ ] Usar ação oficial de teste Hotmart e checkout de teste suportado para comprovar retorno de origem. Não presumir que o payload de teste tem uma flag confiável; nunca enviá-lo ao banco de produção.
- [ ] Confirmar venda aprovada, valor e moeda corretos; repetir webhook três vezes e observar uma compra lógica.
- [ ] Invocar worker autorizado e confirmar Purchase no Meta Test Events do dataset certo, mesmo event_id entre retentativas.
- [ ] Testar token inválido, erro transitório, retry, revogação, reembolso/chargeback e aprovação atrasada.
- [ ] Confirmar dashboard sem PII, por moeda e workspace; aceitação da API não é atribuição de anúncio.
- [ ] Agendar worker/retention, validar proxy antes de habilitar IP e revisar aviso LGPD.
- [ ] Restabelecer publicação de migrações: ferramenta retornou `Invalid or expired requestState`; incremento Meta Ads/ROI continua somente na branch.
- [ ] Aplicar incremento Meta Ads uma vez, publicar `meta-ads` e atualizar painel privado; conferir RLS/grants.
- [ ] Conectar conta autorizada com `ads_read`; comparar gastos, campanhas ativas/pausadas e ROI no mesmo período, fuso e moeda. Validar sinais verde/vermelho sem usar dados demonstrativos como reais.

## Produção — não ativada

- [ ] Registrar evidências dos testes externos sem tokens/PII.
- [ ] Revisar PR e autorizar release separado.
- [ ] Implementar/revisar ativação de CAPI produção: esta versão recusa modo production.
- [ ] Obter fonte legítima da página real, produto/checkout e configuração da campanha; não foram fornecidos nesta tarefa.
- [ ] Publicar somente após revisão e autorização; acompanhar fila e discrepâncias e manter rollback documentado.

Google Ads/Taboola: identificadores preservados; conectores de envio, OAuth e conciliação de gastos não implementados. Não declarar ROAS real.
