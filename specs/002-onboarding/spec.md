# 002 — Onboarding: perfil, carteira existente e primeira carteira

## O problema

O sistema nasceu assumindo uma carteira que já existe. O banco de produção prova
que a premissa estava errada: `movimentacoes` tem 0 linhas, `perfil` tem 0 linhas.
Ninguém nunca completou nada, porque não havia por onde completar.

E a premissa não é só errada para mim: ela é errada para **o caso mais importante**.
Quem já tem carteira sabe o que fazer com um app de carteira. Quem não tem é
exatamente quem precisa de um sistema que diga por onde começar.

> O sistema tem que ser usável tanto para quem já tem ações como, principalmente,
> para quem ainda não tem.

Essa frase é o requisito. O resto deste documento é ela em detalhe.

## O fluxo

```
            ┌─────────────────────────────┐
            │  1. Perfil (18 perguntas)   │  ← já existe
            └──────────────┬──────────────┘
                           │
            ┌──────────────▼──────────────┐
            │  2. Pré-requisitos          │  porteiro, não bloqueio
            └──────────────┬──────────────┘
                           │
            ┌──────────────▼──────────────┐
            │  3. "Você já tem carteira?" │
            └───────┬─────────────┬───────┘
                 SIM│             │NÃO
            ┌───────▼──────┐ ┌────▼─────────────────┐
            │ 3a. Coleta   │ │ 3b. Carteira         │
            │     + enri-  │ │     recomendada      │
            │     quece    │ │     (spec 003)       │
            └───────┬──────┘ └────┬─────────────────┘
            ┌───────▼──────┐      │
            │ 3c. Diagnós- │      │
            │     tico vs  │      │
            │     alvo     │      │
            └───────┬──────┘      │
                    └──────┬──────┘
            ┌──────────────▼──────────────┐
            │  4. Pronto para usar        │
            └─────────────────────────────┘
```

## 1. Perfil — 18 perguntas

Já implementado (`onboarding/questionnaire.py`, `onboarding/profile.py`). Produz
score de risco 0–100, classificação (conservador / moderado / arrojado),
alocação-alvo por classe, horizonte, valor disponível e aporte mensal.

**Nada muda aqui**, com uma exceção de produto descrita no item 2.

## 2. Pré-requisitos — porteiro, não cancela

`build_prerequisites()` já calcula o que precisa estar de pé antes de comprar
ação: reserva de emergência de 6 meses e ausência de dívida cara.

**Regra:** pré-requisito não atendido **nunca bloqueia** o uso do sistema, e
**sempre** aparece no topo da recomendação, antes da carteira. Dizer "quite o
cartão antes de comprar ação" é a recomendação mais valiosa que o sistema pode
dar a alguém, e esconder isso atrás de um fluxo bloqueado só faz a pessoa
mentir na resposta para passar da tela.

### A medição que a unificação destrava

Hoje o questionário **pergunta** quanto a pessoa gasta por mês e se ela tem
reserva. Depois da unificação, as duas respostas podem ser **medidas**:

| Hoje é perguntado | Depois pode ser medido |
|---|---|
| gasto mensal | mediana das despesas de `transacoes` nos últimos 3 meses |
| tem reserva de 6 meses? | saldo das contas + caixinha ÷ gasto mensal medido |
| tem dívida de cartão? | rotativo detectado na fatura |

Isso é o verdadeiro ganho de juntar os dois sistemas: o diagnóstico financeiro
para de depender da memória de quem responde.

**Mas não na primeira vez.** No dia do onboarding não existe histórico de
lançamento nenhum, então a pergunta continua sendo a fonte. A medição entra
como **reconciliação**: a partir de 60 dias de lançamentos, o sistema recalcula
e avisa quando divergir do declarado — "você declarou gastar R$ 3.000; seus
lançamentos dizem R$ 4.200". Quem decide o que fazer com a divergência é a
pessoa; o sistema só não finge que não viu.

## 3a. Coleta da carteira existente

**Entrada mínima: ticker e quantidade.** É tudo que se pode exigir de alguém
que vai digitar isso no celular.

```
VALE3 100
ITUB4 250
HGLG11 30
```

O sistema completa o resto: nome da empresa, classe (ação / ETF / FII), setor,
cotação atual, valor da posição e os indicadores. Quem digita não precisa saber
que VALE3 é mineração.

### Preço médio: opcional, e honesto sobre a consequência

Preço médio é a informação que a maioria não tem à mão, e exigir trava o
onboarding. Então:

- **Informado** → entra como está, e o lucro/prejuízo é real desde o primeiro dia.
- **Não informado** → a posição entra pela cotação do dia da importação, com
  `nota` registrando isso, e o sistema **diz explicitamente** que o resultado só
  passa a ter significado a partir dali. Inventar um preço médio plausível seria
  pior que não ter: viraria um lucro falso em cima do qual alguém decide.

### Validação

Reusa `portfolio/writes.py` — a mesma função que valida a compra pelo WhatsApp
e pela web. Ticker inexistente, quantidade absurda e desvio suspeito de preço
já são tratados lá. Onboarding não ganha caminho de escrita próprio.

### Origem

As movimentações criadas aqui têm `origem = 'onboarding'`, valor novo no
`check` da coluna. Isso não é detalhe de implementação, é o que permite a regra
da spec 004: **posição importada no onboarding não gera despesa**. O dinheiro
dessas compras saiu antes do sistema existir; criar despesa retroativa
destruiria o fluxo de caixa do mês.

## 3c. Diagnóstico da carteira existente

Quem já tem carteira não quer uma recomendação do zero — quer saber o que está
errado na que tem. Com a alocação-alvo do perfil e as posições reais na mão,
tudo isso é aritmética:

- **Desvio por classe:** peso atual contra peso-alvo, em pontos percentuais.
- **Concentração:** maior posição e maior setor, como % do total.
- **Qualidade:** os tickers em carteira passam pelo mesmo filtro da spec 003 —
  se um ativo que você tem seria rejeitado hoje, você fica sabendo o motivo.
- **Convergência:** dado o aporte mensal, para onde mandar o próximo aporte
  para encostar no alvo mais rápido. Sem vender nada — só direcionando o
  dinheiro novo, que é o jeito barato de rebalancear.

**Regra:** o diagnóstico nunca manda vender por desvio de alocação. Venda tem
custo e imposto; desvio se corrige com aporte. Só sugere venda quando o ativo
falha no filtro de qualidade, e aí diz qual critério falhou.

## 3b. Primeira carteira

Delegado para a [spec 003](../003-recomendacao/spec.md).

## 4. Materializar — a regra que protege a verdade

Recomendação aceita **não cria movimentação.**

Aceitar uma carteira sugerida não compra nada: a compra acontece na corretora,
e pode acontecer por outro preço, parcialmente, ou nunca. Se o sistema criasse
as posições no "aceitar", ele passaria a afirmar que você tem ações que você não
tem — e todo número derivado dali (patrimônio, alocação, resultado) seria
ficção.

Então a recomendação é **salva como plano** e vira uma lista de conferência. A
movimentação nasce quando a compra é declarada, no WhatsApp ou na web, pelo
caminho normal de escrita — e é nesse momento, e só nele, que a despesa da
spec 004 é criada.

## O que esta spec deliberadamente não faz

- **Não importa nota de corretagem nem CEI/B3.** Seria a coleta ideal e é
  trabalho de outra ordem (parser de PDF, autenticação no portal). O caminho
  "ticker e quantidade" resolve 100% dos casos em dois minutos de digitação.
- **Não pergunta de novo.** Onboarding completo é estado, não roteiro: dá para
  refazer o perfil e dá para adicionar posição, sempre, sem passar pelo fluxo.
- **Não trata renda fixa individual** (CDB tal, Tesouro tal, com taxa e
  vencimento). A camada de renda fixa é tratada como um bloco só. Modelar título
  a título é outra funcionalidade.
