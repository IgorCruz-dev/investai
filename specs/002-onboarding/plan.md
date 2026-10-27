# Plano — onboarding no PWA

O motor já existe em Python e **nunca teve porta na web**: `onboarding/
questionnaire.py` (as 18 perguntas), `onboarding/profile.py` (score,
classificação, alocação-alvo, pré-requisitos) e `portfolio/writes.py` (validação
de escrita) rodam hoje só pelo WhatsApp (`whatsapp/onboarding_chat.py`). Este
plano é ligação, não construção de motor.

## A decisão de arquitetura: quem deriva o perfil

O PWA **não** deriva o perfil. Ele grava as 18 respostas e enfileira um job; a
VM deriva e grava `perfil_investidor.derivado`.

**Alternativa descartada: portar a derivação para TypeScript** (ou para uma edge
function). São ~200 linhas de regra — faixas de score, deslocamento por
liquidez, pré-requisitos — cobertas por teste em Python. Duplicar isso cria duas
fontes de verdade para o número que manda em toda a recomendação, e as duas
divergem no primeiro ajuste de regra que só uma receber. O preço da escolha é
**latência**: a pessoa responde 18 perguntas e espera o cron.

Esse preço é pago de qualquer forma, porque a carteira sugerida precisa de
yfinance e pandas, que só existem na VM. Então o mesmo job faz as duas coisas, e
a tela usa o polling de job que a aba Investimentos já tem. O que muda é o
intervalo do cron: 5 minutos é tolerável para "conferir ticker", não para a tela
mais importante do produto — `process_jobs.py` passa a rodar a cada minuto.

## Fases

1. **Migração 18.** `jobs.tipo` ganha `'recomendacao'` no `check`. Nova tabela
   `planos` (a recomendação salva como plano da spec 002, item 4), com a mesma
   policy de RLS das outras: dono do sistema, `for all to authenticated`.
2. **Serviço do questionário.** `apps/pwa/src/services/onboarding.ts`: ler e
   gravar `perfil_investidor.respostas`, enfileirar o job, acompanhar o estado.
   As 18 perguntas viram um JSON estático no PWA gerado a partir de
   `questionnaire.py` — **texto e opções**, nunca a pontuação; a pontuação fica
   onde está. Um teste Python afirma que o JSON e o questionário têm as mesmas
   chaves e as mesmas opções, para a cópia não envelhecer calada.
3. **Telas.** `pages/onboarding/`: questionário (uma pergunta por vez, salvando
   progresso), pré-requisitos no topo do resultado (porteiro, nunca bloqueio),
   a bifurcação "já tem carteira?", a coleta `ticker quantidade` em texto livre
   com preço médio opcional, e o diagnóstico da carteira existente.
4. **Estado vazio da aba Investimentos.** Hoje diz "registre uma compra depois
   de executá-la na corretora", que é inútil para quem não tem carteira. Passa a
   oferecer os dois caminhos: responder o perfil ou importar o que já tem.
5. **Reconciliação** (depois de 60 dias de lançamento): comparar gasto declarado
   com a mediana das despesas e avisar na divergência. Fica para o fim — hoje
   não há histórico para reconciliar.

## O que o PWA grava e o que ele nunca grava

| Grava | Nunca grava |
|---|---|
| `perfil_investidor.respostas` | `perfil_investidor.derivado` (é da VM) |
| `movimentacoes` com `origem='onboarding'` | `posicoes` (é do gatilho) |
| linha em `jobs` | `planos` (é da VM) |

A regra de `origem='onboarding'` é o que impede despesa retroativa
([spec 004](../004-aporte-e-despesa/spec.md)), e já está no banco e verificada.

## Invariantes que atravessam

- Recomendação aceita **não cria movimentação** (item 4 da spec): o plano é
  lista de conferência; a posição nasce da compra declarada.
- Pré-requisito não atendido nunca bloqueia o uso do sistema.
- Preço médio não informado entra pela cotação do dia, com `nota` dizendo isso.
