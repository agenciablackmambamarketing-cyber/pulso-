# Funil de sessões — visita ao checkout

A aba **Funil** acompanha as mesmas sessões consentidas pelas etapas Página visitada → Conteúdo visualizado → Clique para comprar → Checkout confirmado. Os filtros Hoje / 7 dias / 30 dias são compartilhados com os relatórios. Não há pessoas ou leads identificados, dados demonstrativos, filtro por campanha ou integração automática na página de vendas nesta entrega.

## Definição e limites

- Coorte: sessão iniciada dentro da janela selecionada, com `page_view` na mesma janela e não anterior à criação da sessão. O relatório termina no horário do banco no momento da consulta; eventos futuros ficam de fora.
- Cada etapa exige um evento na mesma sessão, posterior ou igual ao evento qualificado da etapa anterior. Repetições e retries não aumentam o total. Um evento posterior válido recupera um caminho inicialmente fora de ordem.
- Avanço: sessões na etapa / sessões na etapa anterior. Não avançaram até agora: diferença entre as mesmas etapas. A maior queda destaca o maior volume, não necessariamente a maior porcentagem. Denominador zero resulta em taxa indisponível.
- Sem qualquer `checkout_started` na coorte, a abertura aparece **Não medido**, sem inventar 100% de abandono. Quando existem sinais, as taxas refletem somente a sequência observada; isso não prova cobertura integral do checkout. Ausência pode ser saída, atraso ou falha de instrumentação. Validar cobertura por página/site antes de usar a queda final como perda operacional.
- Sessões que têm clique ou checkout observado sem uma sequência anterior válida aparecem no diagnóstico de etapas ausentes/fora de ordem. Eventos de sessões antigas, sem PageView, sem vínculo ou de outro workspace não entram no funil.
- Os totais antigos da Visão geral contam eventos; o novo funil conta sessões únicas em sequência. Eles não são a mesma medida.

## Segurança e banco

Aplicar **uma vez em staging** `20261029023643_pulso_ordered_session_funnel.sql`. É um incremento de leitura: índice composto + funções de agregação; não altera eventos, vendas, políticas RLS ou credenciais existentes.

`public.pulso_dashboard_funnel(uuid,timestamptz)` é um wrapper `SECURITY INVOKER` com corpo SQL-standard resolvido na definição. Ele delega ao helper privado `private.pulso_dashboard_funnel_counts`, que valida `auth.uid()` e membership real a cada chamada, fixa `search_path` e filtra todas as leituras por workspace. O helper privilegiado é necessário para cruzar identificadores que continuam restritos ao backend. Não se concede `USAGE` no schema privado nem acesso à coluna `funnel_events.tracking_session_id`. A resposta contém apenas contagens, chaves fixas de etapas e janela de tempo. Anônimo e usuários sem membership são recusados; viewer membro pode consultar métricas.

As métricas existentes continuam funcionando se o RPC novo falhar; somente o funil aparece indisponível. Respostas antigas são descartadas após troca de workspace, período ou logout.

## Ativação do Inglês de Embarque

Cópia privada da página real preparada com medição consentida: [INGLES_DE_EMBARQUE_PREVIEW.md](INGLES_DE_EMBARQUE_PREVIEW.md). O original Netlify e o checkout de produção permanecem separados do laboratório; o teste não confirma abertura externa de checkout.

1. Obter URL e fonte legítima da página, preparar cópia de teste e registrar a origem HTTPS com o owner/admin do workspace.
2. Integrar `tracker/pulso-tracker.mjs` à CMP real. Sem consentimento de marketing não há eventos de funil. Emitir PageView e ViewContent conforme o conteúdo realmente observado.
3. Emitir `checkout_click` no clique efetivo. Conservar oferta/afiliado e `sck` existente ao decorar o link de checkout.
4. Emitir `checkout_started` **somente** por um sinal real de abertura/carga do checkout suportado pelo integrador. Não promovê-lo a partir do clique. Em checkout Hotmart hospedado sem esse sinal, a etapa permanece sem confirmação.
5. Comparar sessões e taxas com uma navegação de teste conhecida e validar retomada, recusa/revogação de consentimento e bloqueadores. O webhook de compra comprova a transação, não cada abertura de checkout.

Validação executada nesta revisão: 87 testes Node e 49 testes PostgreSQL local passaram. Incluem coorte10→7→4→2, repetições, ordem, empates, recuperação de sequência, janelas, vazios, isolamento, viewer/revogação e bloqueio de colunas privadas. Não houve QA visual em navegador nesta sessão; a ferramenta de controle de navegador não está disponível. Testes sintéticos não representam tráfego real da campanha.
