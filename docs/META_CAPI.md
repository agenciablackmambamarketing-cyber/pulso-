# Meta CAPI — configuração e operação em staging

Esta entrega fornece cadastro autenticado, criptografia, fila transacional, tentativas e diagnóstico. **O worker processa somente Test Events.** Não há envio de produção habilitado por variável implícita. A lib tem contrato de provedor; Google Ads e Taboola lançam `provider_not_implemented` até implementação/autorização individual.

## Segredos e configuração

Configurar no secret manager de staging, nunca no repositório ou chat:

- `PULSO_META_CREDENTIAL_KEY_V1`: chave aleatória de 32 bytes codificada em base64. AES-256-GCM com IV novo por gravação e AAD `workspace_id:dataset_id`. A chave fica somente nas Edge Functions.
- `PULSO_META_WORKER_SECRET`: segredo aleatório de pelo menos 32 caracteres para o cabeçalho `x-pulso-worker-secret` do agendador. Não expor no dashboard.
- `META_GRAPH_VERSION`: versão Graph explicitamente verificada e suportada no momento do deploy. Sem valor padrão. As páginas oficiais retornaram 429 na auditoria; não se afirma ter confirmado a versão corrente.
- `PULSO_ADMIN_ORIGINS`: origens HTTPS exatas separadas por vírgula do dashboard autorizado. Sem wildcard.
- `SUPABASE_URL` e credencial backend `SUPABASE_SECRET_KEYS` (JSON `default`) ou `SUPABASE_SERVICE_ROLE_KEY`; publishable `SUPABASE_PUBLISHABLE_KEYS` (JSON `default`) ou `SUPABASE_ANON_KEY` para validar usuário com `auth.getUser`.

Credencial CAPI é informada pelo admin no formulário protegido. O token e `test_event_code` são armazenados em um envelope criptografado na tabela privada `meta_capi_credentials`, vinculada ao workspace/destino. A API nunca devolve token, texto descriptografado ou payload Meta. Rotação é feita ao salvar outra credencial; trocar a chave mestre exige recriptografia controlada ou recadastro antes de descartar a chave anterior.

## API administrativa

`POST /functions/v1/meta-connect` recebe Bearer de sessão Supabase e origem autorizada. A função valida `getUser`, depois owner/admin no banco com RPC restrita ao service_role.

- Salvar e verificar: `{action:"save", workspace_id, dataset_id, access_token, test_event_code}`. Apenas `mode=test`. Verifica `GET /{dataset}?fields=id` com token em header e exige ID igual ao cadastrado antes de persistir. Não faz POST de conversão neste passo. Isso confirma acesso de leitura ao dataset; a permissão/entrega de eventos requer Test Events separado.
- Testar acesso salvo: `{action:"test", workspace_id, destination_ref}`.
- Desativar: `{action:"disable", workspace_id, destination_ref}`. Invalida leases e bloqueia pendências.
- Revogar: `{action:"revoke", workspace_id, destination_ref}`. Também apaga o envelope de credencial.
- Reprocessar falha: `{action:"reprocess", workspace_id, destination_ref, outbox_id}`. Exige venda ainda aprovada, consentimento atual, destino ativo, credencial e evento menor que seis dias. Mantém o `event_id` original. Eventos entregues não podem ser reprocessados.

Resposta pública contém somente estado e IDs de configuração, status HTTP/código numérico seguro em falhas. Mensagens arbitrárias retornadas pela Meta nunca vão para banco, logs ou UI.

## Worker

Agendador de staging invoca `POST /functions/v1/meta-worker` com `x-pulso-worker-secret`. Cada invocação reclama um job (`FOR UPDATE SKIP LOCKED`) com lease de 60 segundos, transport timeout de 10 segundos e token de lease novo. Configure frequência/concurrency de acordo com volume e limites Meta. O agendador não foi configurado em produção.

A fila verifica novamente venda aprovada, contexto consentido não expirado, destino e credencial imediatamente antes de enviar. `event_id` é estável por workspace/transação/compra e o destino também participa da chave única. Browser Purchase não é fabricado para checkout externo; se houver futuramente um Purchase de navegador controlado, ele deve usar o mesmo `event_id` e `event_name=Purchase` após confirmação confiável.

HTTP 2xx sozinho não confirma entrega: exige `events_received=1`. Erros 429/5xx/transientes e falhas de rede usam backoff exponencial, até oito tentativas. Falha definitiva e tentativa final cujo worker caiu viram `failed`. `meta_auth` identifica token rejeitado. Aceite de API não garante atribuição de anúncio ou qualidade de correspondência.

Rotação/revogação invalida leases existentes. O término exige token de lease atual, impedindo worker atrasado de sobrescrever resultado novo. Há uma janela inevitável entre a última validação no banco e uma requisição externa já iniciada: um reembolso/revogação durante HTTP pode não cancelar o envio em voo. Evita-se retry posterior; não se promete exatamente uma requisição HTTP. Idempotência lógica depende do mesmo event_id e deduplicação Meta.

## Dados e diagnóstico

`user_data` vem de contexto autorizado capturado na página e de hashes normalizados do webhook autenticado. O IP da Hotmart nunca é usado como IP do comprador. SHA-256 exigido é validado no payload; fbp/fbc/IP/UA não recebem hash. A moeda e o valor da transação são preservados.

`public.capi_delivery_diagnostics` é uma projeção sem PII com RLS por membership: estado, tentativas, código seguro, próxima tentativa, aceite e indicador de teste. A tabela privada continua restrita ao backend. A rotina `private.pulso_scrub_expired_capi()` remove todos os campos de correspondência de eventos cujo contexto consentido expirou/revogou, inclusive entregues, antes da limpeza do contexto; o job de retenção precisa ser agendado em staging.

## Verificação executável

`node --test tests/meta.test.mjs` testa payload, dados autorizados, dedupe, falha de token, dataset errado, criptografia com escopo, autenticação, limite de corpo, retry e lease inválido com rede simulada. As verificações de RLS/fila rodam na suíte Postgres isolada. Não comprovam entrega no provedor.

Para completar o E2E externo: cadastrar uma conta/dataset de teste autorizados; informar test_event_code; usar evento Hotmart de teste associado à sessão consentida; executar worker e conferir `events_received=1`, diagnóstico e recebimento no dataset correto em Events Manager. Nunca substituir a transação por um clique de checkout. Não houve requisições com credenciais reais nesta implementação.

Referências: [CAPI oficial](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/), [parâmetros oficiais](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/), [especificação arquivada mantida pela Meta](https://github.com/facebookarchive/Facebook-Server-Side-API-Swagger/blob/main/server-side-api.yaml). A especificação arquivada foi usada para o contrato de campos, não para escolher versão da Graph.
