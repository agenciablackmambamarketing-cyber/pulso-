# Histórico do novo Supabase do Pulso

Este diretório é um workdir Supabase CLI separado da raiz do repositório. Seus arquivos correspondem exatamente às cinco migrações registradas no projeto isolado `utmfnskpfyykkakmxkcn` em 31/10/2026. Os nomes foram criados com `supabase migration new` e alinhados aos números registrados pelo servidor.

Não execute as migrações novamente nesse projeto nem nos projetos históricos. A migração `pulso_privacy_and_test_worker_schedule` contém a URL específica deste ambiente e, se for usada para um novo ambiente isolado, precisa ser adaptada e revisada. A migração seguinte de revogação de privilégios de `pg_net` não removeu os privilégios herdados no projeto hospedado; a última migração mantém o worker automático desativado. Não reative a fila até resolver a proteção da extensão.

O baseline consolida os oito arquivos indicados por `scripts/plan-fresh-database.mjs`. Ele exige Supabase Auth, papéis Supabase e um banco vazio. Runtime Vault e credenciais externas são configurados separadamente e não estão nos arquivos. O agendamento de retenção não configura a Hotmart, a Meta ou as páginas rastreadas.
