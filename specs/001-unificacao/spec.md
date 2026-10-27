# 001 — Unificação do InvestAI e do Money

## Objetivo

O InvestAI passa a ser um único aplicativo pessoal: controle do dinheiro do mês,
contas e cartões, carteira de investimentos e assistente no WhatsApp consultam o
mesmo banco. A interface é o PWA; o processo Python na VM calcula dados de
mercado, processa pedidos e atende o WhatsApp.

## Regras de produto

- Uma instalação pertence a uma pessoa. O primeiro cadastro do Supabase Auth
  vira o dono; o banco recusa novos cadastros enquanto ele existir. O vínculo
  permanece fixo, para que apagar a conta não entregue a carteira a outra
  pessoa. O bot só atende números explicitamente autorizados no ambiente.
- Lançamentos financeiros e movimentos de investimento dividem o mesmo banco.
  Compra e venda declaradas geram lançamentos segundo a [spec 004](../004-aporte-e-despesa/spec.md).
- `movimentacoes` é a fonte da carteira; `posicoes` é derivada por replay no
  banco. Aceitar recomendação não cria posição (specs 002 e 003).
- A aba Investimentos permite ver posições, extrato e diagnóstico; registrar,
  corrigir e excluir compras e vendas; acompanhar um pedido de atualização
  calculado pela VM. Não deve precisar do painel antigo para essas tarefas.
- Uma falha de cotação ou da VM não apaga a carteira nem inventa dados: a aba
  continua mostrando os últimos dados disponíveis e indica a data deles.

## Migração

As migrações do Money preservam a ordem original e ficam em `supabase/` na raiz.
As tabelas de investimento e a costura vêm depois delas. A troca de banco deve
ser aplicada ao projeto Supabase novo antes de apontar a VM para ele. A URL do
Neon antigo não pode receber essas migrações.

## Decisões

- O PWA absorve a interface de investimento. O painel `apps/web` e o registro
  central de tenants deixam de ser caminhos de produção.
- O Postgres guarda as regras que precisam valer para PWA, bot e escrita direta;
  cálculos de mercado ficam no Python da VM.
- A identidade visual única usa o tema escuro e dourado do InvestAI.
