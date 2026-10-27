# 003 — Recomendação de carteira por cálculo, com veto por notícia

## O requisito

> O sistema recomenda uma carteira pra ele, baseada nas respostas, no mercado
> atual, na subida ou descida das ações, tudo através de cálculos matemáticos
> bem feitos e extremamente precisos.

Duas palavras dessa frase mandam no desenho: **cálculos** e **precisos**.
"Cálculos" quer dizer que **nenhum número da carteira sai de um modelo de
linguagem** — seleção, nota, peso e cota são aritmética. "Precisos" quer dizer
que cada número tem procedência e que a soma fecha.

O pedido foi depois ampliado para incluir notícia na decisão; a revisão de
27/10/2026, mais abaixo, abre exatamente uma porta para isso — o veto — sem
mexer em nenhum número.

## A regra de custo manda nos números

O orçamento do produto fixa que só briefing, análise de ativo e `/pergunta`
podem chamar a API da Anthropic. O código chamava a recomendação inteira por um
modelo por padrão (`recommend(..., use_llm=True)`) — violação que estava de pé
por falta de teste que a pegasse. **Isso continua proibido**, e por um motivo
que não é economia: uma recomendação de carteira precisa ser **reproduzível**
(mesma entrada, mesma saída) e **auditável** (o porquê de cada peso em número).
Um modelo de linguagem não dá nenhuma das duas, e para escolher peso ele não
acrescenta nada que o filtro quantitativo não dê melhor.

Seleção, nota, peso, cotas e a soma fechando no centavo são **cálculo, sempre**.
`build_recommendation_context` e `_merge_llm_positions` — o caminho que deixava
um modelo mexer em posição e peso — saem de vez, e a mina de `pytest.fail` da
fixture `ambiente` continua apontada para lá.

## Revisão de 27/10/2026 — o veto por notícia

A decisão original desta spec era **nenhum** modelo de linguagem no caminho.
O usuário pediu a revisão nestes termos: "LLM trabalhando em conjunto com
estatística pura", com a recomendação olhando também as últimas notícias.

A revisão abre **uma** porta, estreita e nomeada:

> O modelo pode **tirar** um ativo da seleção por notícia grave, com o motivo
> registrado. Não pode pôr ativo nenhum, nem mexer em nota, peso ou cota.

### Por que só o veto

O filtro quantitativo é cego para uma classe de risco real: fraude contábil,
intervenção regulatória, saída de bolsa, recuperação judicial. Esses eventos
aparecem em texto antes de aparecerem em preço, volatilidade ou P/L — e quando
aparecem no número, já custaram. Ler notícia e reconhecer "isto é grave" é
exatamente o que um modelo de linguagem faz melhor que uma régua.

Pôr ativo ou ajustar peso é outra coisa. Ali o modelo competiria com um cálculo
que já é melhor que ele, cobrando crédito e reprodutibilidade em troca.

### O que se perde, dito com clareza

**A seleção deixa de ser reproduzível.** A mesma carteira, recomendada em dois
dias diferentes, pode sair diferente porque a notícia mudou. Isso é consequência
aceita, não efeito colateral esquecido — e é mitigado, não escondido:

- Todo veto é **gravado com o ativo, o critério, a frase que o justificou, a
  data e a fonte**. Uma recomendação antiga continua *explicável* mesmo sem ser
  *reproduzível*: dá para ler por que PETR4 ficou fora naquele dia.
- O veto aparece na lista de rejeitados, do lado dos rejeitados por cálculo, com
  a etiqueta de que a origem foi notícia e não número.
- **Os pesos continuam reproduzíveis.** Dado o conjunto de ativos selecionados,
  nota, peso, cota e sobra são função pura da mesma entrada de sempre.

### Os limites do veto

- **Teto.** O veto pode derrubar no máximo **um ativo por classe** por rodada.
  Sem teto, uma notícia ruim de mercado derrubaria a carteira inteira e o
  "cálculo decide" viraria letra morta.
- **Nunca esvazia classe.** Se o veto deixaria uma classe com peso sem nenhum
  candidato aprovado, ele é **descartado** e o ativo fica, com o alerta visível.
  A regra da camada vazia desta spec já diz que classe sem candidato não é
  realocada; deixar o veto criar esse buraco seria piorar a carteira por causa
  de uma manchete.
- **Só grave, e enumerado.** Os critérios são fraude ou erro contábil, pedido de
  recuperação judicial ou falência, intervenção de regulador, saída de bolsa, e
  evento operacional catastrófico. Queda de lucro, downgrade de analista, preço
  caindo e "clima ruim para o setor" **não** são veto: são número, e o número já
  os vê.
- **Dúvida não veta.** Sem notícia grave e inequívoca, a resposta é "nenhum
  veto". O ônus é do veto, não do ativo.

### Degradação

Sem chave da Anthropic, sem notícia, com a API fora ou estourando o tempo, a
recomendação **sai igual, sem veto**, marcada como *sem triagem de notícia*.
A triagem é uma camada de proteção opcional; a recomendação nunca depende dela
para existir.

### O custo, e onde ele é contido

Isto acrescenta o primeiro caminho pago fora de briefing, análise de ativo e
`/pergunta` — a regra de custo muda **de propósito** e passa a listar a triagem
de notícia. Contenção:

- A triagem roda sobre os **aprovados** (~10 a 15 ativos), não sobre o universo.
- O resultado é **cacheado por ativo e por janela de notícia**: abrir a tela de
  novo não paga de novo; só paga quando entra notícia nova ou ativo novo.
- A função de triagem — e só ela — entra na mina de `pytest.fail` da fixture
  `ambiente`, para nenhum teste gastar crédito e nenhum caminho novo escapar.
- O caminho determinístico continua alcançável e testado **sem** a triagem.

## O cálculo, em cinco etapas

### 1. Universo

~40 ativos da B3 curados por classe e setor (`screener.UNIVERSE`): ETFs amplos,
ações líquidas cobrindo 12 setores, FIIs de tijolo e de papel. Lista curada em
vez de "toda a bolsa" porque liquidez e governança mínimas não são calculáveis
de graça, e uma recomendação que inclui uma small cap ilíquida é pior que uma
que a ignora.

### 2. Eliminação — critérios duros, por perfil

Cada ativo é aprovado ou rejeitado, **com o motivo em texto**:

| Critério | Corte |
|---|---|
| Dado de preço | ausente -> fora |
| Liquidez | < R$ 5 mi/dia de volume financeiro -> fora |
| Volatilidade 30d anualizada | acima do teto do perfil -> fora |
| Tendência | MM20 < MM50 < MM200 -> fora (só nos perfis que rejeitam queda) |
| P/L (só ações) | <= 0 (prejuízo) ou acima do teto do perfil -> fora |
| Dívida/Patrimônio (só ações) | acima do teto do perfil -> fora |
| Dividend yield (só ações) | abaixo do piso do perfil -> fora |

Fundamento não é aplicado a ETF e FII: P/L de um ETF não é comparável com P/L de
uma empresa, e tratar os dois com a mesma régua é o tipo de erro que parece
rigor.

**Os rejeitados são mostrados, com o critério que falhou.** Uma recomendação que
só diz o que comprar é uma caixa preta; dizer "PETR4 ficou fora por
volatilidade de 58% contra o seu teto de 40%" é o que permite discordar dela.

### 3. Pontuação 0-100

Os aprovados recebem nota a partir de 50, somando e subtraindo fatores com
procedência — tendência das médias móveis, RSI de 14 por Wilder, volatilidade
anualizada, P/L, dividend yield, endividamento e retorno de 12 meses. Cada
ajuste gera uma linha de justificativa junto.

É deliberadamente um modelo **aditivo e legível**, não uma regressão ajustada:
com ~40 ativos e dado fundamental de qualidade irregular, um modelo mais
sofisticado seria precisão aparente sobre entrada ruidosa. O que o modelo precisa
ser é **estável e explicável**, e isso ele é.

### 4. Seleção e peso

- A alocação-alvo por classe vem do perfil (% em ação, FII, ETF, renda fixa).
- Dentro da classe, até `MAX_ASSETS_PER_CLASS` ativos (5 ações, 3 FIIs, 2 ETFs),
  **preferindo diversidade de setor**: entre dois ativos de nota parecida, o de
  setor ainda não representado entra primeiro.
- Com pouco dinheiro, menos ativos: nenhuma posição abaixo de **R$ 300**, porque
  uma posição de R$ 40 custa mais em corretagem e atenção do que rende em
  diversificação.

**Peso proporcional à nota** (mudança em relação ao código atual, que divide a
classe em partes iguais): dentro de uma classe, o peso de cada ativo é
`peso_classe x nota_i / soma(notas)`, com cada peso limitado a **0,5x a 1,6x do
peso igual** e depois renormalizado.

A trava existe porque proporcionalidade pura é instável: com notas 72 e 68, a
diferença de peso tem que ser pequena, não dramática — a nota não é precisa o
suficiente para justificar uma posição três vezes maior que a outra. A trava é o
que transforma uma ordenação confiável em pesos confiáveis.

### 5. Cotas, e a sobra que não desaparece

`cotas = piso(valor / preço)` — o mercado fracionário da B3 permite 1 ação, então
não há problema de lote.

O arredondamento sempre sobra dinheiro. Hoje essa sobra simplesmente evapora e a
carteira recomendada não soma o valor disponível. **Regra nova:** a sobra de todos
os arredondamentos é somada à camada de renda fixa, que tem liquidez diária e
aceita qualquer valor.

Resultado: **quando todas as classes com peso puderam ser preenchidas, a soma das
posições é exatamente o valor disponível** — até o centavo, afirmado por teste.

A condição não é letra miúda, é a fronteira entre precisão e invenção. Se uma
classe inteira não tem nenhum ativo aprovado (o yfinance caiu, ou os critérios do
perfil rejeitaram tudo), o dinheiro dela **não** é realocado para a renda fixa:
isso faria a soma fechar entregando uma carteira que ninguém pediu, com a cara de
decisão deliberada. O buraco é declarado em texto, com o tamanho dele em
porcentagem, e a carteira sai marcada como incompleta.

Fechar a conta mexendo na alocação seria exatamente o tipo de precisão aparente
que esta spec recusa.

## Degradação honesta

O yfinance cai. Quando cai:

- Sem **nenhum** ativo avaliável -> não existe recomendação. A tela diz isso e
  oferece atualizar os dados. Não existe carteira de consolação.
- Só a renda fixa de pé (ela não depende de cotação) -> a recomendação sai
  marcada como **incompleta**, com o motivo. Uma camada de renda fixa sozinha
  apresentada como "sua carteira" seria uma mentira por omissão.

## Fonte de dados: por que não a B3 direto

A B3 não publica API pública e gratuita de cotação e fundamento. O que existe é
dado de pregão em arquivo, com atraso e sem fundamento, e revenda paga.

O yfinance (sufixo `.SA`) entrega preço, histórico e fundamento dos tickers da
B3, sem chave, e já está em produção aqui. **Alternativa mapeada:** `brapi.dev`,
API brasileira com dado da B3 e free tier — vale como fonte de reserva se o
yfinance degradar, pelo mesmo contrato de `market_data.py`. Não entra agora:
uma segunda fonte só paga o próprio custo depois que a primeira der problema
medido.

## O que esta spec deliberadamente não faz

- **Não faz otimização de média-variância** (Markowitz). Exigiria matriz de
  covariância estimada em série curta de ativo brasileiro — estimativa com erro
  grande o suficiente para a "fronteira eficiente" ser ruído com casas decimais.
  Peso por nota com trava é menos elegante e mais honesto.
- **Não recomenda ativo fora do universo curado.**
- **Não promete retorno.** Nenhum número de retorno esperado aparece na saída.
- **Não deixa modelo de linguagem escolher, pontuar ou pesar ativo.** A revisão
  de 27/10/2026 abriu o veto e só o veto; a alternativa de pôr o modelo na
  seleção e nos pesos foi considerada e recusada, por custo por recomendação e
  por perda de auditabilidade do peso.
- **Não usa notícia como fator de nota.** Notícia entra como veto binário com
  motivo, nunca como pontinho somado a um score — isso seria dar procedência
  numérica a um juízo que não tem.
