# Plano — recomendação com veto por notícia

O cálculo das cinco etapas já existe (`analysis/screener.py`,
`analysis/recommender.py`). O que falta é (a) tirar o caminho pago antigo, que
deixava um modelo mexer em peso, (b) acrescentar o veto por notícia da revisão
de 27/10/2026, e (c) dar uma tela a tudo isso.

## Fase 1 — fechar o caminho errado antes de abrir o certo

`build_recommendation_context` e `_merge_llm_positions` saem. Eles são o caminho
que a spec recusa: modelo escolhendo posição e peso. Enquanto existirem, um
`use_llm=True` em qualquer chamador os alcança.

Sai também o parâmetro `use_llm` de `recommend()`. A mina de `pytest.fail` da
fixture `ambiente` em `tests/test_server.py` deixa de apontar para
`build_recommendation_context` e passa a apontar para a triagem nova — se a mina
ficar apontada para uma função que não existe, ela para de proteger.

## Fase 2 — a triagem, isolada e minável

Módulo novo `src/investai/analysis/triagem_noticia.py`, com uma função pública:

```python
def triar(candidatos: list[Candidate], *, dias: int = 7) -> dict[str, Veto]
```

`Veto` guarda `ticker`, `criterio`, `frase`, `fonte`, `url` e `data` — a spec
exige que um veto antigo continue explicável. A função:

1. busca notícia por ticker com `data/news_fetcher.fetch_financial_news`
   (Google News + Currents, já em produção no briefing);
2. **se não há notícia, devolve `{}` sem chamar o modelo** — nenhuma chamada paga
   sem matéria-prima;
3. manda ao modelo as manchetes dos aprovados com os cinco critérios graves
   enumerados na spec, pedindo resposta estruturada e **ônus no veto**;
4. descarta veto cujo critério não está na lista, por mais convincente que a
   justificativa pareça. A lista é código, não prompt.

É a **única** função paga do módulo, e é ela que entra na mina.

O cache vive em `cache/` pelo par `(ticker, janela de notícia)` — abrir a tela
de novo não paga de novo.

## Fase 3 — aplicar o veto sem deixá-lo mandar

Em `recommend()`, entre a aprovação do screener e a seleção:

- veto derruba **no máximo um ativo por classe** por rodada;
- veto que deixaria uma classe com peso sem candidato é **descartado**, e o
  ativo fica com o alerta visível;
- vetado entra em `Recommendation.rejected` com etiqueta de origem `noticia`,
  separado dos rejeitados por número;
- sem chave, sem notícia, API fora ou tempo estourado → recomendação igual,
  marcada *sem triagem de notícia* em `Recommendation`.

`Recommendation` ganha `vetos: list[Veto]` e `triagem_ok: bool`. O campo `source`
(`"quantitativo"` / `"claude"`) perde sentido e sai: o número é sempre cálculo.

## Fase 4 — persistência e tela

A VM, dentro do job `recomendacao` da [spec 002](../002-onboarding/plan.md),
grava a recomendação em `planos` como JSON pronto — posições, rejeitados, vetos,
marcas de incompleta e de sem-triagem. O PWA só lê.

A tela mostra, nesta ordem: pré-requisitos pendentes (spec 002), as posições com
a justificativa de cada peso, os rejeitados com o critério, os vetos com a frase
e a fonte, e os avisos de carteira incompleta ou sem triagem. Aceitar salva o
plano como lista de conferência e **não cria movimentação**.

## Testes que precisam existir

- A soma das posições fecha no valor disponível **até o centavo** quando todas as
  classes com peso foram preenchidas (já é regra da spec; o teste a fixa).
- Classe sem candidato aprovado **não** é realocada para renda fixa.
- Veto respeitando teto por classe; veto que esvaziaria classe é descartado.
- Veto com critério fora da lista é ignorado.
- Sem notícia, `triar` devolve `{}` **sem chamar o modelo** — teste que falha se
  chamar.
- Recomendação completa roda com a mina ativa, provando que o caminho
  determinístico não paga nada.
