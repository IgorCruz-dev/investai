# Andamento

- [x] Especificar o cálculo em cinco etapas, a degradação e o que não fazer.
- [x] Revisar a spec para o veto por notícia (decisão do usuário em 27/10/2026)
      e registrar a alternativa recusada: modelo pesando a carteira.
- [x] Escrever o plano de implementação.
- [x] Fase 1: `build_recommendation_context`, `_merge_llm_positions`,
      `SYSTEM_PROMPT`, `RESPONSE_SCHEMA`, o campo `source` e o parâmetro
      `use_llm` saíram. A mina de `pytest.fail` passou a apontar para
      `triagem_noticia.consultar_modelo`.
- [x] Fase 2: `analysis/triagem_noticia.py` com `triar()`, cache por ticker e
      janela de notícia, e os cinco critérios graves validados em código.
- [x] Fase 3: veto aplicado em `recommend(triagem=True)`, com teto de um ativo
      por classe, descarte do veto que esvaziaria classe, e marca de
      *sem triagem* quando não roda.
- [x] Fase 4: `scripts/publish_recomendacao.py` grava em `planos` pelo job da
      VM, e `pages/onboarding/CarteiraSugerida.tsx` desenha o plano.
- [x] Os testes do plano, inclusive o que prova que o caminho determinístico
      não gasta crédito e o que exige a soma fechando no centavo.

## O que a execução real revelou

A primeira rodada contra o mercado de verdade somou **R$ 24.000,02** para
R$ 24.000,00 de disponível, violando a promessa desta spec. A causa: `distribute`
somava a sobra posição por posição, e o arredondamento de cada `amount` escapava
da conta. Com a fixture sintética o erro não aparecia, porque fundamento igual
em todos os ativos dá peso igual e os arredondamentos se cancelam.

Corrigido: a sobra passou a ser `destinado - aplicado`, calculada no fim. A
segunda rodada real fechou em R$ 24.000,00 exatos, e
`test_soma_fecha_no_centavo_com_notas_e_precos_irregulares` fixa o caso com nota
e preço diferentes por ativo.

Plano: [plan.md](plan.md) · Spec: [spec.md](spec.md)
