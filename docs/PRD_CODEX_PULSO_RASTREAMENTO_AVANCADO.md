# Tarefa para Codex — Pulso Campanhas | Rastreamento avançado e conversões (MVP)

## Missão
Desenvolver, testar e preparar para implantação a camada própria de tracking first-party e transmissão server-side de conversões do **Pulso Campanhas**, inicialmente usada pela nossa agência, mas estruturada como SaaS multi-tenant. **Prioridade funcional:** Hotmart → rastreador → Meta Pixel + Meta Conversions API (CAPI). Preparar interfaces desacopladas para Google Ads e Taboola, sem declarar conectores como concluídos antes de implementar e validar.

**Resultado de negócio:** identificar corretamente a campanha e a sessão que originaram a venda; transmitir à plataforma de anúncios eventos legítimos de compra com valor, moeda, produto e dados de correspondência permitidos; evitar eventos duplicados; diagnosticar perdas de atribuição. Meta Event Match Quality 10/10 é um objetivo de melhoria, **não uma garantia** nem autorização para driblar escolhas de privacidade/iOS.

## Contexto existente — auditar antes de alterar
- Supabase de produção existente: projeto `pulso-campanhas`, referência `nlrhtioxsbncpluchfcz`.
- Edge Functions existentes: `hotmart-webhook` e `hotmart-connect`. Estão publicadas, mas **não há confirmação de uma conexão real da Hotmart nem de envio de conversões real**. Não romper compatibilidade nem modificar endpoints publicamente sem revisão e testes.
- Estruturas existentes a inspecionar: `public.workspaces`, `workspace_members`, `integrations`, `ad_accounts`, `campaigns`, `daily_ad_metrics`, `sales`, `order_events`, `tracking_sessions`, `funnel_events`, `attributions`, `financial_ledger`, `conversion_destinations`; e `private.hotmart_sources`, `integration_credentials`, `visitor_match_context`, `conversion_event_outbox`, `webhook_events`.
- `sales` tem uma coluna `raw` potencialmente sensível: seu acesso de leitura por `authenticated` foi revogado e só métricas e campos não sensíveis foram liberados. Respeitar essa proteção; nunca expor buyer PII, tokens, hashes de identificação, IP ou user-agent no dashboard.
- RLS está habilitada e há restrições que devem impedir referência entre workspaces diferentes. Validar por testes adversariais; não assumir segurança perfeita apenas por existir RLS.
- Existem colunas de tracking `fbclid`, `gclid`, `gbraid`, `wbraid`, `tblci`, UTMs, `src`, entre outras. Conferir o esquema real antes das migrações.
- O frontend 2.0 foi previamente preparado para publicação, mas pode ainda não estar implantado. Localizar repositório/código-fonte legítimo do projeto; se não estiver acessível, entregar código integrável e documentação, sem inventar acesso.

## Trabalho solicitado

### A. Auditoria e plano técnico
1. Examinar código, migrações, deploys e políticas de acesso antes de editar. Identificar como o webhook da Hotmart valida Hottok, trata retries e estados financeiros, e em que formato recebe `src`/`sck`/`xcod`.
2. Criar uma matriz de dados (fonte → tratamento → destino → retenção → permissão) e um diagrama simples do fluxo. Mapear riscos de exposição e cruzamento de tenants.
3. Não executar migrações destrutivas nem iniciar envios para contas reais sem aprovação explícita. Trabalhar em branch e ambiente de teste, usando mocks.

### B. Coletor first-party nas páginas de vendas
4. Desenvolver SDK leve para sites estáticos/Netlify, sem comprometer desempenho. Instrumentar `PageView`, visualização da oferta, clique no botão de compra, início do checkout (`InitiateCheckout` apenas quando realmente ocorrer) e outras etapas efetivamente observáveis.
5. Criar identificadores de sessão próprios com expiração, TTL e respeito a consentimento, capturando UTMs (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`), `src`, `sck`, `xcod`, `fbclid`, `_fbp`, `_fbc`, `gclid`, `gbraid`, `wbraid`, `tblci` somente quando disponíveis e permitidos. Não inventar valores ausentes.
6. Capturar IP e `User-Agent` no endpoint do servidor de forma confiável (não aceitar valores arbitrários do corpo do navegador; tratar corretamente cabeçalhos de proxy confiáveis), quando permitido e necessário. **O IP do webhook Hotmart não é o IP do comprador.** Não implementar fingerprinting invasivo nem técnicas de contorno a bloqueios.
7. Criar endpoint público de coleta com limites de taxa, tamanho de payload, validação de origem/domínio configurado, validação de entrada, antibot básico e proteção contra spoofing de `workspace_id` e `pixel_id`.
8. Implementar banner/mecanismo de preferências quando necessário, registrar base legal/consentimento com versão e timestamp, e garantir que o bloqueio de marketing afete tanto browser quanto CAPI. Não armazenar nem enviar sinais publicitários sem base legal adequada. Garantir políticas de retenção e exclusão.

### C. Continuidade página → Hotmart → pedido
9. Criar função de enriquecimento dos links de checkout Hotmart que preserve parâmetros legítimos e carregue um identificador de sessão **opaco, assinado e não pessoal** em campo suportado e documentado (`sck`/`src`/`xcod`, conforme compatibilidade). Não sobrescrever parâmetros de afiliado ou campanhas. Suportar link externo e Checkout Elements, verificando os limites de comprimento e particularidades de ambos.
10. No Webhook Hotmart V2, validar autenticação; deduplicar por ID de evento e ID de transação; reconciliar eventos fora de ordem; manter a regra de que reembolso/chargeback não pode ser revertido indevidamente por webhook atrasado. Guardar valores e moeda de origem corretamente.
11. Associar compra a sessão por identificador confiável, sem presumir atribuição por mera coincidência de tempo ou por UTM genérica. Quando faltar correspondência, marcar `unattributed` com motivo observável, e não forçar crédito a anúncio.
12. Lidar separadamente com vendas aprovadas, pendentes, canceladas, reembolsadas, recorrência, order bump e upsell, considerando os IDs individuais de transação e evitando duplicar a compra principal.

### D. Meta Pixel + CAPI (prioridade da primeira entrega)
13. Adicionar configuração de Pixel/Dataset por workspace; token Meta só em backend seguro, com segregação de permissões e rotação de segredo. Nunca retornar token para frontend nem registrá-lo em logs.

#### Credenciais da Meta Conversions API — requisito obrigatório para o Codex
- **Pixel ID / Dataset ID**: identifica para qual fonte de dados da Meta o evento deve ser enviado. É a configuração pública do Pixel na página, não é um segredo de autenticação.
- **Conversions API Access Token (CAPI)**: autentica **exclusivamente no servidor** os pedidos de envio de eventos para o Pixel/Dataset correspondente. **O token não identifica o comprador**; a correspondência ocorre pelos identificadores de clique/navegador e por `user_data` permitido, mais detalhes do evento. O `event_id` faz a deduplicação.
- Para cada **workspace e dataset**, guardar o identificador e uma **referência a segredo** (Vault/KMS/secret manager), nunca o token em texto na tabela `public.conversion_destinations`, em `localStorage`, bundle JavaScript, links ou logs. A conexão deve ser criada apenas pelo administrador autorizado e validada contra o Pixel/Dataset correto antes de ativar envios.
- Interface administrativa: **Conectar Meta → escolher/registrar Pixel/Dataset ID → fornecer token em formulário protegido ou OAuth apropriado → testar conexão → ativar**. Exibir apenas estado, últimos quatro caracteres mascarados se apropriado, escopos/erros não sensíveis, data de conexão, renovação/revogação. Não retornar segredo depois de salvo e nunca solicitar que seja enviado em chat.
- Primeira fase da nossa agência: configuração segura de **Pixel/Dataset ID + token CAPI** gerado no **Gerenciador de Eventos da Meta → fonte de dados → Configurações → API de Conversões → gerar token** (rótulos da interface podem variar). Fase futura SaaS: pesquisar e implementar autorização escalável via fluxo apropriado de Meta Business Login/OAuth e permissões exigidas, sem fingir que esse fluxo já está concluído.
- Envio de `Purchase` pelo servidor: requisição autenticada ao endpoint de eventos do Dataset/Pixel na versão atual e suportada da Graph API; `access_token` somente no backend, event_id estável, transação Hotmart confirmada, consentimento/base legal conforme a finalidade, retries idempotentes, resposta de erro tratada sem revelar token.
- Testes: token inválido/revogado, Pixel ID de outra empresa, troca de token sem vazamento, ausência de token = envio bloqueado (não tratar como sucesso), evento de teste recebido no Dataset **certo**, e logs sem material confidencial.
- **Separação de credenciais**: Hottok da Hotmart autentica o webhook; token CAPI da Meta autentica o envio de eventos; eventual token OAuth da Meta Marketing API para leitura/gestão de campanhas é outra integração e não deve ser confundido com o token de CAPI.
14. Mapear browser + server para o mesmo destino da empresa correta. Enviar `PageView`, `ViewContent` e outros eventos do browser apenas se instrumentados e autorizados. `Purchase` server-side deve ser confirmado **pela venda aprovada da Hotmart**, nunca somente por clique no checkout.
15. Para cada compra válida enviar `event_name=Purchase`, `event_time`, `event_id` estável (ligado à transação e tenant), `action_source=website`, `event_source_url` quando verdadeiro, `custom_data.value`, `currency`, `content_ids`/`contents` quando verificáveis, `order_id` se suportado, e `user_data` permitidos.
16. Dados para matching conforme documentação Meta: normalizar e aplicar SHA-256 em e-mail, telefone e outros identificadores que exigirem hash; não aplicar hash em `_fbp`, `_fbc`, IP ou user-agent quando enviados nos respectivos campos. Não logar nem disponibilizar informação pessoal ao painel ou contratantes. Minimizar coleta e tempo de retenção.
17. **Deduplicação:** quando houver `Purchase` tanto no browser quanto na CAPI, garantir `event_name` idêntico e o **mesmo** `eventID` no Pixel / `event_id` no servidor. Se o checkout for externo e não houver evento de compra controlável no browser, enviar compra apenas server-side, sem fabricar evento duplicado. Implementar fila transacional/Outbox, idempotência por tenant/destino/evento, retry com backoff, monitoramento e DLQ ou estado falhado.
18. Testar com Meta Test Events, não com pedidos reais não autorizados. Verificar envio aceito, campos necessários, deduplicação e ausência de cross-tenant. Medir a correspondência, mas não prometer 10/10.

### E. Preparação Google Ads e Taboola
19. Definir interfaces de `ConversionProvider` com adaptadores separados para Meta, Google Ads e Taboola. Manter `tenant_id`, destino, credenciais e IDs de conversão isolados.
20. **Google Ads:** preservar `gclid`, `gbraid`, `wbraid` e `order_id`; pesquisar o fluxo correto para vendas web vs. enhanced conversions e ajustes/reembolsos, bem como sinalização de consentimento. Preparar modelos e testes unitários sem ativar upload real sem configuração e aprovação da conta.
21. **Taboola:** preservar `tblci`, mapear o Click ID corretamente e preparar S2S com `click-id`, evento, valor, moeda e pedido conforme documentação. Evitar divulgar `tblci` entre workspaces. Só habilitar quando conta, regra de conversão e teste estiverem configurados.

### F. Segurança para SaaS desde o início
22. Isolamento multi-tenant em **cada** gravação, consulta, destino de pixel, credencial, outbox e job; políticas RLS e FKs compostas tenant-aware. Nunca confiar no `workspace_id` fornecido por um navegador sem validação de domínio/chave pública vinculada, limitação de operações e verificações server-side.
23. Segredos via secret manager/Vault/KMS compatível, com criptografia em repouso e privilégio mínimo. Revisar funções `SECURITY DEFINER`, schemas privados, grants, claims JWT, vistas com `security_invoker`, proteção contra vazamento em error logs e configuração CORS limitada às origens autorizadas.
24. Painel de agências: somente KPIs agregados, valores de conversão, status de integrações, qualidade de atribuição e diagnóstico, **sem e-mails, telefones, IPs, hashes de identificadores, tokens ou payloads brutos**. Administradores operacionais internos estritamente autorizados podem acionar tarefas de infraestrutura sem expor esses dados na UI.
25. Definir exclusão/retention automática, suporte a solicitações de titulares, trilha de auditoria, consentimento/base legal por finalidade, minimização e política aplicável (LGPD, termos das plataformas). Hash não é anonimização garantida.

### G. Observabilidade e dashboard
26. Dashboard por workspace e por destino com: eventos capturados/recebidos/enviados/aceitos/falhos, percentual de vendas atribuídas, motivo de não atribuição, deduplicações, eventos sem consentimento/base legal, tempo entre compra e confirmação, divergências entre Hotmart e Ads e saúde da conexão. Não declarar que conversões aceitas pela API já foram necessariamente atribuídas pela plataforma.
27. Logs estruturados **sem PII**, métricas e alertas de evento parado, filas acumuladas, token expirado, falha de Hottok, aumento de atribuição desconhecida e rejeições de APIs.

## Casos de teste obrigatórios
- Dois workspaces: com sessão/campanha/transação semelhante, jamais associar dados ou enviar ao Pixel da empresa errada.
- Webhook Hotmart repetido 3x → uma venda registrada e no máximo um evento lógico por destino; retries não criam Purchase extra.
- `APPROVED` → `REFUNDED` → evento antigo `APPROVED` não ressuscita venda nem gera novo Purchase.
- Página → checkout externo → venda: link assinado correlaciona corretamente; se Hotmart não retornar origem, venda fica sem atribuição, com diagnóstico.
- Visitante que rejeita marketing não dispara Pixel/CAPI de marketing nem armazena sinais correspondentes.
- Compra sem `_fbp` ou `_fbc`, navegador com bloqueios ou iOS: fallback lícito e diagnóstico; não fabricar dados.
- Teste de duplicação entre browser Pixel e CAPI com `eventID`/`event_id` iguais.
- Compra com moeda diferente da do workspace; valores transmitidos na moeda da transação, sem somar moedas distintas.
- Teste que usuário `authenticated` não lê `public.sales.raw` nem tabelas `private` sensíveis; visitante `anon` não lê vendas ou credenciais.
- Testar rate limits, eventos com payload inválido, origens falsas, assinatura inválida/expirada, token vencido, falha externa, backoff e reprocessamento seguro.

## Ordem de execução e critérios de aceite
**P0** — revisão de segurança + tracking de sessão + vínculo confiável Hotmart + Meta CAPI com fila e deduplicação; testado em staging por mocks e Test Events. Tudo sem dados pessoais na UI. É o MVP prioritário.
**P1** — dashboard de saúde do pixel e atribuição, métricas detalhadas, testes end-to-end reais *somente com conta de teste e autorização*.
**P2** — adaptadores prontos para autenticação e implementação real do Google Ads e Taboola, seguidos de testes individuais antes de ativar.

## Entregáveis do Codex
1. Código versionado (branch/PR), migrations reversíveis, dependências fixadas e lockfile.
2. Testes automatizados com saída verificável, incluindo teste de isolamento multi-tenant e idempotência; informe o que passou e o que não foi executado.
3. Documentação `README` com arquitetura, eventos, IDs, consentimento, política de retenção e configuração Netlify/Supabase.
4. Lista **dos nomes** de variáveis de ambiente e passos OAuth/Pixel/Hotmart necessários — **nunca peça que o usuário cole segredos em chat nem grave segredos no Git**.
5. Checklist de ativação em staging e produção, com rollback.
6. Relatório final separado em **implementado**, **testado**, **bloqueado por configuração/credenciais** e **ainda não iniciado**, sem alegar uma integração externa ativa antes de verificá-la.

## Documentação técnica a consultar e validar na versão atual
- Hotmart Webhook V2: https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/purchase-webhook/
- Hotmart Checkout Elements: https://developers.hotmart.com/docs/pt-BR/tutorials/checkout-elements/
- Meta CAPI: https://developers.facebook.com/docs/marketing-api/conversions-api/
- Google Ads enhanced conversions: https://developers.google.com/google-ads/api/docs/conversions/upload-online
- Taboola S2S: https://developers.taboola.com/pixel/docs/s2s-manual-integration
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

**Comece pela inspeção segura do projeto e pelo P0. Se o repositório não estiver acessível ao Codex, não invente sua estrutura: gere um módulo desacoplado com contratos, testes e um plano de integração.**