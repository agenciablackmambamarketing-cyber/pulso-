# Pulso — P0 tracking first-party (implementação incremental)

## Já codificado no repositório

`tracker/pulso-tracker.mjs` é um SDK **opt-in**, desacoplado e sem dependências externas. Ele:
- só envia `page_view`, `view_content` e `checkout_click` quando `marketingAllowed()` for verdadeiro;
- persiste ID aleatório de sessão apenas após permissão, com escopo de sessão do navegador;
- transmite parâmetros explicitamente autorizados (`utm_*`, `src`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `tblci`) e `_fbp`/`_fbc` quando presentes;
- elimina parâmetros arbitrários da URL (inclusive email, CPF, telefone) e nunca captura nome/email/telefone no browser;
- anexa `sck` ao checkout **somente** se o coletor devolver um token opaco (a assinatura e validade precisam ser garantidas pelo servidor); preserva `sck` e links existentes;
- não emite `Purchase` a partir do navegador. Compra confirmada pertence ao webhook Hotmart.

**NÃO ESTÁ ATIVO NAS PÁGINAS E NÃO HÁ COLETOR PÚBLICO IMPLANTADO.** A implantação do coletor servidor, configuração de site, assinatura criptográfica, limites de taxa e associação à compra ainda são P0 pendentes. Não inserir script em produção até que o backend esteja pronto e auditado.

## Fluxo previsto

`Página de vendas -> pulso-collect (site_key + domínio validado; rate-limit; consentimento) -> tracking_sessions + visitor_match_context`.

`pulso-collect -> devolve handoff assinado/expirável -> link checkout Hotmart sck`.

`Hotmart webhook autentica Hottok -> dedup transaction/event -> associa sck assinado -> attributions`.

`Compra APPROVED/COMPLETE confirmada + permissão aplicável -> private.conversion_event_outbox -> worker CAPI Meta -> Dataset do workspace`.

**Dados de comprador**: apenas para correspondência legítima no servidor, isolados por workspace, com normalização/hash SHA-256 dos identificadores que exigem hash; nunca apresentar email, IP, hashes ou tokens aos usuários do dashboard. `ip` e `user-agent` do comprador, se aplicáveis, são observados no servidor da página; nunca confundir com IP do webhook Hotmart.

## Antes de testar campanha real

1. Conferir produção vs Git: banco possui 12 migrações já executadas, e repositório contém só parte desse histórico. Construir baseline/snapshot seguro no ambiente de teste. **Não reaplicar `20261025_pulso_core.sql` no banco existente.**
2. Implementar `pulso-collect`: validação de site_key/domínio, corpo 16KB máx, autenticação do site com chave pública e proteção adicional, limites de taxa por IP e site, proteção anti-spoofing de workspace/pixel, TTL e consentimento auditável, política CORS restrita e _fail closed_.
3. Handoff `sck`: assinatura HMAC com chave em segredo (não expor ao navegador), expiração e verificação no webhook, vinculação uma-para-uma por tenant, não sobrescrever afiliação.
4. Interface admin de Meta Dataset + token CAPI em Vault/secret manager, nunca na tabela pública. Testar id do dataset, com botão desativar/revogar.
5. Worker CAPI com fila, retries com backoff, hash correto e event_id estável para deduplicação; não mandar conversão sem confirmação Hotmart nem autorização aplicável.
6. Sandbox/teste automatizado: duas agências, cross-tenant, eventos duplicados, reembolso, consentimento negado, checkout sem `sck`, Meta resposta erro/retry e validação com Test Events.
7. Integrar o SDK na página do Inglês de Embarque **sem** mudar a publicação original até o teste de checkout e entrega do produto.

## Como rodar os testes locais

`node --test tests/pulso-tracker.test.mjs`

Os testes são simulações. Eles **não** comprovam a entrega de eventos na Meta, Hotmart ou Supabase.

## Integrações futuras

Google Ads (`gclid`, `gbraid`, `wbraid`, enhanced conversions) e Taboola (`tblci`, S2S): apenas esquema/preparação. Precisam de conectores, permissões, credenciais e eventos reais próprios. Não confundir eventos de atribuição com números de ROAS até conciliar gasto e receita.