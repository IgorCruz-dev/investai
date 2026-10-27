# 004 — A costura: comprar ação é uma despesa

## A decisão

> Comprar ação vai ser categorizado como investimento.

É isso que transforma dois aplicativos num repositório em **um** sistema.

Sem a costura, comprar R$ 500 de VALE3 exige duas anotações da mesma coisa: uma
em `movimentacoes` (a compra) e uma em `transacoes` (o dinheiro que saiu da
conta). Duas anotações manuais do mesmo fato divergem na primeira vez que você
esquecer uma — e aí nem o saldo do mês nem o patrimônio estão certos.

## A regra

**Toda compra declarada cria uma despesa. Toda venda declarada cria uma receita.**

| Movimentação | Lançamento criado | Categoria |
|---|---|---|
| compra | despesa | Investimento |
| venda | receita | Investimento |
| ajuste | nenhum | — |

- **Valor:** `cotas x preço + taxas`. As taxas entram na despesa porque saíram
  da conta; no custo da posição elas já entram por `writes.py`.
- **Descrição:** `Compra de 100 VALE3` — legível no extrato do mês, sem precisar
  abrir a aba de investimentos para entender o lançamento.
- **Forma:** `pix`, por padrão configurável. Transferência para corretora é Pix
  na prática esmagadora dos casos.
- **Categoria:** `Investimento`, criada pela migração junto das categorias
  padrão, que hoje não a tem.

## Onde a regra mora: no banco

Gatilho em `movimentacoes`, não código Python.

O motivo é o invariante que o projeto já segue para "não vender o que não se
tem": a regra mais profunda mora no banco, onde nem um `psql` na mão passa por
cima. Aqui isso vale ainda mais, porque existem **três** caminhos de escrita —
o bot do WhatsApp, o PWA pelo `supabase-js`, e eu mesmo no `psql`. Regra em
Python só cobriria o primeiro, e o PWA escrevendo direto criaria posição sem
despesa, silenciosamente.

## A exceção que protege o histórico

**Movimentação de `origem` `onboarding` ou `migracao` não gera lançamento.**

O dinheiro dessas compras saiu da conta antes de o sistema existir. Criar
despesa retroativa para elas colocaria R$ 40 mil de gasto num mês que não teve
esse gasto, destruindo o fluxo de caixa do histórico — exatamente o dado que o
lado financeiro existe para guardar.

Só `origem in ('web', 'whatsapp')` dispara a costura: é o conjunto das compras
declaradas **no momento em que aconteceram**.

## Desfazer

Apagar ou editar uma movimentação tem que mexer no lançamento correspondente,
senão a divergência volta por outra porta. O vínculo é explícito: a `transacoes`
criada guarda o id da movimentação que a gerou, e o gatilho trata
`update` e `delete` além do `insert`.

Isso também dá a resposta para "por que essa despesa de R$ 2.340 apareceu no meu
mês?" — ela aponta para a compra que a criou.

O lançamento espelhado não pode ser apagado diretamente nem ter valor, tipo,
data ou categoria alterados pelo formulário financeiro. Essas correções são
feitas na movimentação que o originou. Conta de origem e forma de pagamento
continuam editáveis, para a pessoa atribuir de onde o dinheiro saiu.

## O que esta spec deliberadamente não faz

- **Não cria a conta de origem automaticamente.** A despesa nasce sem
  `conta_id`: o sistema não tem como saber de qual conta saiu o dinheiro, e
  chutar colocaria saldo errado numa conta real. Fica em aberto para a pessoa
  atribuir, como qualquer lançamento importado.
- **Não trata provento** (dividendo, JCP, rendimento de FII) — que é receita e
  deveria entrar como tal. É funcionalidade própria, com retenção e data-com
  para modelar, e tem spec própria quando chegar a vez.
- **Não mexe no cálculo de patrimônio.** Investimento aparece como despesa no
  fluxo de caixa do mês e como patrimônio na carteira. Não é contagem dupla: são
  duas perguntas diferentes — "quanto sobrou este mês" e "quanto eu tenho".
