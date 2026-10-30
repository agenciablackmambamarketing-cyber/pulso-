# Campanhas e retorno

## Escopo e cálculo

O relatório combina **todas as vendas aprovadas registradas no workspace**, sem filtrar a plataforma de venda, com o investimento das contas de mídia conectadas. Cada moeda é calculada separadamente; não há conversão cambial implícita. Reembolsos e chargebacks deixam de compor a receita aprovada.

`ROI de mídia (%) = (receita aprovada − investimento em mídia) / investimento em mídia × 100`

Positivo aparece em verde e com sinal `+`; negativo em vermelho e com sinal `−`; zero é neutro. O painel só calcula quando todas as contas conectadas daquela moeda cobrem o período, os fusos coincidem com o workspace e o investimento é maior que zero. Dados ausentes, acesso revogado, erro, dia não importado ou atualização do dia atual com mais de uma hora tornam o agregado indisponível. Investimento zero não significa ROI zero.

Este é um retorno agregado da operação sobre a mídia importada, antes de taxas e outros custos. Não comprova atribuição das vendas aos anúncios. Lucro líquido e ROI líquido permanecem indisponíveis até conciliar todos os custos. `verified_net_revenue` exige valores líquidos verificados e moeda de liquidação explícita coincidente em todas as vendas aprovadas.

## Conectores

Nesta entrega o conector de mídia implementado é **Meta Ads**, com leitura de campanhas e gastos do Facebook/Instagram. Hotmart é o conector de vendas implementado. Google Ads, Taboola e outras plataformas de venda dependem de conectores próprios; não são considerados conectados nem têm gasto desconhecido substituído por zero. O contrato informa `media_providers` e `revenue_scope` para que novos adaptadores conservem escopo, moeda, cobertura, fuso e isolamento por workspace.

O resumo inclui o gasto de todas as campanhas no período, inclusive pausadas. A lista de campanhas ativas usa `effective_status` informado pela Meta na última sincronização. O gasto total da conta é a fonte financeira; a soma das campanhas é conferida e uma divergência maior que 0,01 rejeita a importação integral. Uma paginação incompleta não grava dados parciais.

## Conectar em staging

Estado em30/10/2026: incremento, função e painel privado já publicados no staging `osgumasejgumqlnqxcvm`. As etapas1–3 abaixo já foram concluídas nesse projeto; não reaplicar. Ainda não há conta de anúncios conectada. Começar pelo cadastro protegido da etapa4.

1. Aplicar uma única vez `20261029124537_pulso_meta_ads_read_cache.sql` depois dos incrementos anteriores. Não reaplicar baseline ou migrações antigas em banco existente.
2. Publicar `meta-ads` com `supabase/config.toml`. O endpoint valida a sessão via `getUser`, origem exata e papel owner/admin no backend; membros podem ler apenas agregados do próprio workspace.
3. Configurar o conjunto completo `PULSO_ADMIN_ORIGINS`, `PULSO_META_CREDENTIAL_KEY_V1`, `META_GRAPH_VERSION` no backend, ou usar o escopo Vault `meta_connect` já provisionado no staging. Não misturar configuração parcial. A chave AES é compartilhada pelo runtime, com contexto criptográfico distinto para CAPI e anúncios; as credenciais são independentes.
4. No painel, em Integrações, cadastrar ID da conta de anúncios e um token autorizado com `ads_read`, acesso à conta e permissões exigidas pelo aplicativo Meta. Inserir somente no campo protegido, nunca em Git, variáveis públicas ou chat. A validação faz apenas leituras de conta, campanhas e insights; não envia conversões nem altera anúncios.
5. Em Campanhas e retorno, selecionar Hoje/7/30 dias e sincronizar cada conta. Períodos são dias de calendário no fuso do workspace. Contas em outro fuso exibem diagnóstico e bloqueiam comparações financeiras até alinhar os períodos.

Os dados ficam em cache privado, com credencial AES-GCM vinculada ao workspace e à conta. A sincronização usa lease de 120 segundos e gravação atômica; rotação/revogação invalida trabalhos antigos. O navegador não recebe tokens. O status Meta Ads é separado da Conversions API. O incremento também impede que o cadastro CAPI reutilize uma integração de anúncios.

## Verificação e limites

Testes locais usam PostgreSQL descartável e respostas Graph simuladas: autorização, isolamento, credenciais, revogação, corrida de sincronização, paginação, cobertura, moedas, reembolsos, ROI e preservação CAPI. Não são prova de acesso a uma conta Meta real.

Para concluir o teste externo, conectar uma conta autorizada pelo formulário, comparar a mesma janela/fuso/moeda com o Gerenciador de Anúncios, verificar campanhas ativas e pausadas com gasto e revogar/reconectar. Os testes oficiais de webhook Hotmart e Test Events CAPI continuam separados. Não habilitar conversões reais ou produção sem autorização explícita. A sincronização Ads é manual nesta versão; agendamento e alertas permanecem pendentes.

O transporte limita cada requisição a10 segundos e cada coleção a20 páginas. Contas muito grandes ou lentas podem exceder a lease de120 segundos e serão rejeitadas sem gravação parcial; processamento assíncrono dessas contas permanece pendente.

Referências oficiais: [Meta Insights](https://developers.facebook.com/docs/marketing-api/insights/), [permissão ads_read](https://developers.facebook.com/docs/permissions/), [Supabase Auth em Edge Functions](https://supabase.com/docs/guides/functions/auth).
