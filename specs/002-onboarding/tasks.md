# Andamento

- [x] Especificar o fluxo, os pré-requisitos como porteiro e a regra de que
      recomendação aceita não cria movimentação.
- [x] Escrever o plano de implementação no PWA.
- [x] `origem = 'onboarding'` no banco, sem despesa retroativa (spec 004),
      verificada por `scripts/verificar_costura.py`.
- [x] Migração 18 (`20261027060000_planos.sql`): `'recomendacao'` em
      `jobs.tipo` e tabela `planos` com RLS. Aplicada.
- [x] `services/onboarding.ts` e `data/perguntas.json`, gerado por
      `scripts/exportar_perguntas.py`, com `tests/test_onboarding_export.py`
      afirmando que a cópia não divergiu de `questionnaire.py` — e que a
      pontuação de risco **nunca** é exportada.
- [x] `process_jobs.py` no cron de 1 minuto.
- [x] Telas: questionário (uma pergunta por vez, com rascunho no navegador),
      bifurcação "já tem carteira?", coleta `ticker quantidade` com preço médio
      opcional, e a carteira sugerida.
- [x] Estado vazio da aba Investimentos oferecendo os dois caminhos.
- [ ] Diagnóstico da carteira existente (item 3c), parcial:
      - [x] desvio por classe (card "Divisão da carteira em bolsa");
      - [x] concentração: maior posição e maior setor, como % do que está em bolsa;
      - [ ] **qualidade**: passar os tickers em carteira pelo filtro da spec 003
            para dizer "este ativo que você tem seria rejeitado hoje, por tal
            critério". Falta porque o ativo da pessoa pode estar fora do universo
            curado, e avaliar um ticker arbitrário é trabalho da VM — precisa de
            um job que rode `evaluate()` sobre a carteira dela, não sobre o
            universo;
      - [ ] **convergência**: para onde mandar o próximo aporte. Depende do
            aporte mensal derivado, que a tela de Investimentos ainda não lê.
- [ ] Reconciliação do gasto declarado contra os lançamentos. Fica para depois
      de 60 dias de histórico, como o plano previu: hoje não há o que reconciliar.

## Decisão de implementação que a spec não previa

A spec diz que o preço médio é opcional e que, sem ele, a posição entra "pela
cotação do dia da importação". Na prática a cotação vem do último snapshot, e
numa instalação nova **não existe snapshot** — a carteira está vazia, então nada
foi calculado ainda. Em vez de inventar um preço, a importação **pede o preço
médio** das linhas sem cotação conhecida, nomeando quais. É a mesma razão da
spec: um lucro falso em cima do qual alguém decide é pior que a pergunta extra.

Plano: [plan.md](plan.md) · Spec: [spec.md](spec.md)
