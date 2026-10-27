# Plano — unificação

1. Trazer o Money para `apps/pwa`, preservando seu histórico; mover `supabase/`
   para a raiz.
2. Criar as tabelas de investimento e o gatilho de compra/venda; aplicar todas
   as migrações no Supabase novo e verificar o lançamento gerado.
3. Remover `apps/web`, o registro de tenants e os caminhos multiusuário da VM;
   deixar configuração, bot, crons e migrações com um banco da instalação.
4. Aplicar a identidade visual no PWA e conferir as telas em navegador.
5. Criar a aba Investimentos no PWA usando Supabase Auth/RLS para leitura e
   escrita do ledger. Usar `jobs` e `snapshots` para dados calculados pela VM.
6. Atualizar setup, deploy e README para a topologia única e executar testes e
   build antes de publicar.

O InvestAI anterior tinha 16 commits; o Money importado tinha 71. A contagem de
71 commits do InvestAI registrada antes media o repositório errado.

A aplicação no projeto novo terminou com 17 migrações: as 12 originais do Money,
investimentos, costura, proteção dos lançamentos espelhados, cadastro pessoal
e dono estável. As três últimas fecham caminhos que poderiam quebrar o vínculo
do extrato ou dar a carteira a outra conta.
