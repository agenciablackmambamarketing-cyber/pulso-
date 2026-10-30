# Configuração de runtime via Supabase Vault

O cadastro de Edge environment secrets não está disponível na conexão desta sessão. Em vez de simular esse cadastro ou expor chaves no frontend, esta versão usa uma integração explícita com o [Supabase Vault](https://supabase.com/docs/guides/database/vault), que oferece armazenamento criptografado e gerenciamento por SQL suportado oficialmente.

## Fronteira de acesso

- `private.pulso_runtime_secret_refs` contém somente nomes permitidos e UUIDs do Vault. RLS habilitada; PUBLIC, anon, authenticated e service_role não leem diretamente a tabela.
- `public.pulso_runtime_config(p_component)` tem `SECURITY DEFINER`, search_path vazio, execução somente service_role e mapeamentos fixos por componente. Não é uma API administrativa de cliente nem aceita nomes arbitrários de segredos.
- A função lê apenas as referências necessárias ao componente. Schema Vault não é acessível a anon/authenticated no staging.
- Os wrappers usam a identidade de servidor nativa do projeto Supabase. Nenhum token de serviço é substituído ou enviado ao navegador.
- Environment completo tem precedência. Environment parcialmente preenchido falha; não mistura HMAC/AES/origens vindos de fontes diferentes. Sem environment, busca no Vault. Dados inválidos ou incompletos falham sem retornar valores ao chamador.
- Não há RPC para usuários gravarem os segredos globais. Operador privilegiado usa o gerenciador Vault/SQL autorizado. O token CAPI continua cadastrado por workspace no formulário e cifrado com AES-GCM; a master key fica protegida no Vault.

## Estado do staging

A migração `20261028091816_pulso_vault_runtime_config.sql` foi aplicada somente ao projeto `osgumasejgumqlnqxcvm`. Sete configurações foram provisionadas. HMAC, chave de rate-limit, chave AES e segredo worker foram gerados dentro do banco por `extensions.gen_random_bytes`, guardados via `vault.create_secret`, sem retornar valores ao executor, chat ou Git. A operação de provisionamento não substitui referências já existentes nem rotaciona chaves implicitamente.

As origens administrativas apontam para `https://pulso-campanhas-staging.fersthome.chatgpt.site`. `META_GRAPH_VERSION=v26.0` foi escolhido com base no [SDK oficial da Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py), cujo default consultado era v26.0/SDK26.0.2. A página oficial de changelog continuou retornando429; aceitação no dataset específico precisa ser validada com Test Events. Não se afirma versão mais nova verificada pelo changelog.

O IP continua desabilitado por padrão. Nenhuma credencial Hotmart/Meta real foi criada ou copiada. Produção não recebeu a migração nem os wrappers novos.

## Operação

Para conferir prontidão, selecionar apenas nomes/contagem das referências e ACLs; não selecionar valores de `vault.decrypted_secrets` em relatórios. Não copiar segredos ao chat, Git, dashboard público ou argumentos de shell. Faça backup e rotação usando os controles do Vault; trocar a master AES sem recriptografar/reconectar as credenciais existentes as torna ilegíveis. Não remover referências como forma de reset silencioso.

Antes de futuro deploy em produção, provisionar HMAC completo: o novo webhook exige configuração antes da ingestão financeira. Isso não mudou o endpoint de produção existente. O worker permanece test-only, sem opção de habilitar conversões reais.

Os testes locais usam uma view Vault falsa somente para testar permissões/escopo. Não são prova de criptografia. No staging, o Vault real foi usado e os testes confirmaram sete referências, acesso negado para usuários e coletores consumindo a configuração de servidor. Nenhum material cifrado ou decifrado foi incluído na evidência.
