# Inglês de Embarque — cópia privada para medir o funil

Página original fornecida pela agência: https://ingles-de-embarque-black-mamba.netlify.app/

Caminho da cópia no painel privado: https://pulso-campanhas-staging.fersthome.chatgpt.site/teste-ingles-de-embarque/

A página original permanece no Netlify sem alteração. O conector confirmou deploy manual (`drop`), sem Git/framework/arquivo de fonte informado nos metadados. A cópia usa o HTML publicado e oito imagens públicas dessa página, com hashes de procedência em `tracker/previews/ingles-de-embarque/snapshot.json`. Não equivale ao checkout ou à publicação de produção.

## Teste manual

1. Entrar no painel de staging com a própria conta e selecionar o workspace da agência. Conferir a indicação **Ambiente de testes**.
2. Abrir a cópia privada acima. A medição começa desativada. Recusar permite continuar sem eventos de marketing; se houver sessão anterior, a revogação usa o fluxo de privacidade do SDK.
3. Aceitar **medição de teste**. O controlador registra PageView com o instante e a versão da autorização, antes dos eventos seguintes.
4. Rolar até a oferta. ViewContent exige que pelo menos50% do preço da oferta esteja visível na aba ativa, no momento da autorização ou depois. Ver algo antes de consentir e sair da tela não gera uma visualização retroativa.
5. Clicar em um dos dois botões de compra. A cópia registra somente `checkout_click` autorizado e mostra a confirmação de teste. Os links são inertes mesmo sem JavaScript: nenhum checkout é aberto, token de handoff exibido ou compra enviada.
6. Voltar ao painel, abrir **Funil** e atualizar o mesmo workspace/período. São sessões de teste efetivamente observadas no staging, não pessoas únicas ou tráfego de produção. Repetir eventos na mesma sessão não aumenta as etapas do funil.
7. Revogar a medição e verificar que novos cliques não são coletados. Se o servidor não confirmar a revogação, a coleta fica desativada localmente e **Reenviar revogação** tenta novamente; não é necessário aceitar marketing para isso.

O original dispara Meta PageView ao carregar e InitiateCheckout no clique, sem uma CMP encontrada no HTML. Esses dois emissores foram removidos **somente da cópia**, que restringe conexões ao coletor staging por CSP. O consentimento do laboratório é específico para testes; aviso de privacidade/CMP de produção e revisão legal continuam pendentes.

## O que está integrado

- SDK first-party existente, com retomada assinada e consentimento obrigatório, ligado pelo controlador `tracker/preview-session.mjs`.
- PageView, ViewContent e clique para comprar; ordenação, UUIDs estáveis em retries, limiar de visibilidade atual, barreira de revogação e expiração após24h.
- Chave pública do site registrada apenas no Supabase de staging para a origem HTTPS exata do painel privado. Nenhum token Hotmart/Meta ou workspace_id está no código da página.
- Guarda de runtime recusa domínio Netlify de produção e qualquer outro caminho/origem. O builder copia a campanha somente para o projeto staging conhecido e limpa cópia anterior se o diretório for reutilizado para outro projeto.
- Checkout confirmado continua **Não medido**: a página externa não fornece sinal confiável de abertura. Um clique não cria `checkout_started`, Purchase ou envio CAPI.

## Validação e limites

**Navegação manual recebida em29/10/2026:** o usuário informou ter realizado o teste. A leitura do backend confirmou1 PageView,1 ViewContent e4 eventos de clique, todos em uma única sessão consentida vinculada à cópia registrada. O funil ordenado é1→1→1; abertura de checkout permanece não medida. Não há venda nem registro na outbox Meta, e a Hotmart continua pendente de evento oficial. Evidência agregada, sem identificadores pessoais: `backend-audit/ingles-preview-manual-2026-10-29.json`. Isso comprova a continuidade da sessão e a coleta, não a taxa de abandono de uma campanha nem a inspeção visual do navegador pelo agente.

103 testes Node passaram, incluindo10 do controlador e6 do artefato/integração SDK com transporte simulado: ausência de coleta antes do consentimento, visibilidade atual, retries, cliques rápidos, revogação em voo, expiração, preservação de assets, CSP, checkout inerte e isolamento de origem/build. Sintaxe e `git diff --check` passaram. Não houve QA visual ou sessão autenticada de navegador: a ferramenta de controle não está disponível.

No coletor hospedado: preflight da origem privada204, origem da página de produção403, requisição completa com consentimento recusado403/consent_required. Consulta confirmou um site registrado e zero sessões/eventos na agência antes de uma navegação manual; os testes não adicionaram visitas fictícias ao seu funil.

Antes de produção: obter/revisar fonte mantida, integrar CMP/aviso final, validar produto e checkout oficialmente suportado, comprovar retorno sck no webhook de teste Hotmart e Purchase em Meta Test Events. Não instalar essa cópia diretamente no domínio de produção: ela bloqueia a medição fora do endereço privado e desativa compras por projeto. A ativação real exige revisão e autorização separadas.
