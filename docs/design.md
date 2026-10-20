# Decisões de projeto

Este documento é para quem vai **mexer** no InvestAI. O
[README](../README.md) conta o que o sistema faz e como usá-lo; aqui estão as
escolhas de construção por trás disso — por que uma fonte de dados e não outra,
onde o modelo decide e onde não, o que o sistema deliberadamente não faz.

Nada aqui é necessário para usar o sistema. É necessário para discutir um PR.

---

## Princípios

- **Nada estoura na cara do usuário.** Toda função de I/O é blindada (`@safe`) e devolve
  valor padrão — DataFrame vazio, `{}` — com log claro. Indicador que não pôde ser
  calculado vira `None` e aparece como **N/D**, nunca como número inventado. Isso vale
  também para totais: valor e custo somam as **mesmas** posições, senão um ativo sem
  cotação ainda viraria prejuízo falso.
- **Resiliência num só lugar.** `retry` com backoff exponencial (3 tentativas), `Throttle`
  com relógio compartilhado sob lock e cache em disco com escrita atômica.
- **RSI pela definição de Wilder.** A inicialização usa a média simples dos 14 primeiros
  ganhos/perdas antes da suavização recursiva. Validado contra a série de referência
  clássica (70,46 / 57,92).
- **Contexto do LLM filtrado e com orçamento.** O prompt leva apenas carteira,
  indicadores já calculados, fundamentals disponíveis e até 5 notícias por ativo.
- **Uma validação só.** `src/investai/portfolio/writes.py` é usado pelo WhatsApp e pela web; a
  regra mais profunda (não vender o que não se tem) mora no **banco**, onde nem um
  `psql` na mão passa por cima.

---

## Por que Google Notícias e não a Currents

Comparação feita contra as duas APIs reais em 12/10/2026, buscando as notícias
da semana de VALE3:

| Fonte | Query | Resultado |
|---|---|---|
| Currents (`pt`) | `Vale` | Futebol (Palmeiras), gastronomia, política — **nenhuma** notícia da mineradora. Consultas de duas palavras (`Vale mineração`) devolvem **zero** artigos |
| Google Notícias | `VALE3 when:7d` | 62 itens de Valor Investe, Seu Dinheiro, InfoMoney, Estadão, CNN Brasil |

A diferença é a **chave de busca**: o ticker (`VALE3`, `ITUB4`) é inambíguo e a
imprensa financeira brasileira sempre o escreve, enquanto o nome da empresa
colide com palavras comuns do português ("vale a pena", "o Itaú da favela"). O
Google também é usado sem chave e aceita janela temporal (`when:7d`).

Os resultados da Currents, quando ela entra como reserva, passam por um filtro
de relevância: o artigo precisa citar a empresa **e** ter contexto financeiro ou
regulatório, senão é descartado antes de chegar ao LLM — ruído não é informação
neutra, ele ativamente distorce a análise.

---

## Onboarding: por que 18 perguntas e não um formulário

O questionário combina duas origens:

- **5 perguntas do diagnóstico da AUVP (Raul Sena)**: nota honesta para a
  situação financeira atual, comprometimento com os objetivos, prioridade dos
  próximos 12 meses, nível de conhecimento e faixa de renda. *(O formulário
  original tem 14 campos, mas 9 são captação de lead — nome, WhatsApp, "como
  descobriu", disposição de pagar o curso — e não dizem nada sobre perfil.)*
- **As dimensões de suitability** que a regulação brasileira exige e que
  faltavam ali: reserva de emergência, dívidas de juros altos, custo de vida,
  capacidade de aporte, horizonte, necessidade de liquidez, estabilidade de
  renda, reação a uma queda de 30% e experiência com produtos.

### Ordem antes de otimização

O sistema não pula direto para "compre estas ações". A sequência é: dívida de
juros altos → reserva de emergência (6 meses de despesas) → diversificação ampla
via ETF → ativos individuais. Quem declara dívida de cartão recebe um bloqueio
explícito, porque quitá-la rende mais, com certeza, do que qualquer carteira de
ações.

### Como a carteira sugerida é montada

Três etapas separadas de propósito:

| Decisão | Quem decide | Como |
|---|---|---|
| Quanto em cada classe | `src/investai/onboarding/profile.py` | Regra determinística sobre o questionário (score de risco 0-100 → perfil → alocação, com ajustes por horizonte, liquidez e objetivo) |
| Quais ativos podem entrar | `src/investai/analysis/screener.py` | Filtro quantitativo sobre 38 ativos líquidos da B3, com dados reais: liquidez mínima, P/L, dívida/patrimônio, dividend yield, volatilidade e tendência |
| Pesos e justificativa | `src/investai/analysis/recommender.py` + Claude | O Claude distribui os pesos **dentro** das classes e explica cada escolha citando o dado. Se sugerir ticker fora da lista aprovada ou furar o peso da classe, a resposta é descartada e vale o rateio determinístico |

O LLM nunca escolhe um ativo que o filtro reprovou nem muda a alocação por
classe — e, sem `ANTHROPIC_API_KEY`, a recomendação sai completa pelo caminho
determinístico.

### Teto para iniciante

Horizonte longo infla o score de risco com facilidade. Quem se declara iniciante
e nunca comprou ativo de risco não é classificado como arrojado, porque
tolerância a queda só se comprova vivendo uma — o sistema explica o teto na tela.

### Por que não existe `temperature`

A geração Opus 5 **removeu** esse parâmetro da API (enviá-lo devolve HTTP 400). O
rigor factual vem do system prompt — que exige citar o dado que embasou cada
conclusão — e de `INVESTAI_EFFORT`.

---

## Custo: o roteador determinístico

Até aqui toda mensagem passava pelo agente, que carrega as definições de 8
ferramentas (~4 mil tokens) em cada requisição. A primeira mensagem de uma
conversa escreve esse prefixo no cache a 125% do preço de entrada: ~US$ 0,030
para responder "como está minha carteira?", cuja resposta é um `SELECT` e três
linhas de formatação.

Agora um roteador determinístico (`src/investai/whatsapp/router.py`) resolve a intenção
**antes** de qualquer chamada de modelo:

| | Hoje | Antes |
|---|---|---|
| "como está minha carteira?" | **US$ 0** | ~US$ 0,030 |
| "comprei 100 PETR4 a 35,50" | **US$ 0** | impossível |
| `/analise PETR4` | ~US$ 0,020 | ~US$ 0,030 |
| `/briefing` | ~US$ 0,10 | ~US$ 0,10 |

As duas rotas de IA também ficaram mais baratas porque **deixaram de usar o
agente**: o Python monta o contexto de que precisa e faz **uma** chamada sem
ferramenta nenhuma — ~1,5 mil tokens de entrada em vez de ~5,5 mil, sem escrita
de cache e sem laço de iteração.

---

## Decisões do assistente no WhatsApp

- **Reuso sem LLM.** As ferramentas em `src/investai/agent/tools.py` são
  `BetaFunctionTool`, mas continuam sendo função Python chamável. O roteador as
  invoca direto — mesma formatação que já estava em produção, sem modelo no meio.
- **Resolução pura.** `router.resolver()` não toca em rede, banco nem modelo:
  olha o texto e a sessão e devolve a intenção. É isso que permite testar a
  tabela inteira offline e afirmar, com teste, que nenhuma rota barata chama a API.
- **Comando explícito vence vocabulário.** `/pergunta analisa PETR4` é pergunta
  livre, não análise — o que vem depois da barra é argumento.
- **Lista branca de números** e **teto de gasto mensal**, que agora só bloqueia
  as rotas de IA: travar a consulta de carteira porque o briefing estourou o
  orçamento seria punir o caminho que não custa nada.

---

## Interface web: por que a VM não escuta a internet

**A VM continua sem nada escutando na internet.** Nenhuma porta aberta, nenhum
túnel, nenhum domínio — era a propriedade mais valiosa do deploy anterior e foi
preservada tirando o estado de dentro dela. Vercel e VM nunca se falam: os dois
falam com o banco.

Quando a web precisa de algo que só a VM faz (gerar briefing, conferir um ticker
novo no yfinance), ela insere uma linha em `jobs` e o cron da VM executa na
próxima passada. Fila por banco: sem webhook, sem porta aberta.

A web **não calcula indicador**. A VM publica um snapshot em `snapshots` a cada
30 minutos (cron), e a tela lê o último. Já carteira e extrato vêm **ao vivo** do
banco, porque mudam quando você registra uma compra — esperar meia hora para ver
a própria compra aparecer seria esquisito.

### Autenticação

Uma senha só, porque o sistema é de uma pessoa só — mas está na internet:

- a senha **não existe em lugar nenhum**: o que fica guardado é um hash
  PBKDF2-SHA256 com 210 mil iterações e salt aleatório, em variável de ambiente
  da Vercel;
- acertar devolve um cookie `exp.assinatura` (HMAC-SHA256 do prazo),
  `HttpOnly; Secure; SameSite=Lax`, de 30 dias. Adulterar o prazo invalida a
  assinatura;
- dez erros em quinze minutos do mesmo IP bloqueiam, e toda tentativa fica
  registrada em `tentativas_login`;
- o HTML é uma **casca pública**: nenhum dado privado vive em arquivo estático,
  e tudo que importa vem autenticado da API. É por isso que não há middleware
  protegendo páginas — não há o que proteger ali.

PBKDF2 e HMAC vêm do Web Crypto, que já existe no runtime: zero dependência de
biblioteca de autenticação.

### Por que posição é derivada e não digitada

O replay recomputa tudo a cada escrita — para um ledger pessoal isso custa
microssegundos, e elimina a classe de bug em que um delta incremental deixa a
posição torta para sempre sem ninguém notar. Editar ou apagar uma movimentação
corrige a posição sozinho, e não existe caminho em que posição e histórico
divirjam.

O preço médio pondera com as taxas dentro do custo — que é também o critério da
Receita para apurar ganho de capital, então o resultado realizado do extrato
serve para o imposto, não só para a tela.

Fica em **SQLite na VM** o que só o bot lê: conversas, idempotência, gastos e o
estado de sessão (confirmação pendente, onboarding em andamento). Uma ida ao
Postgres por mensagem custaria latência sem ninguém do outro lado precisar do
dado.

---

## Várias pessoas, um banco para cada

O sistema nasceu para uma pessoa, e isso está no **schema**: `posicoes` tem
`ticker` como chave primária e `perfil` é `check (id = 1)` — uma carteira e um
perfil por banco.

Quando apareceu a necessidade de três pessoas usarem o mesmo bot, havia dois
caminhos:

| | Coluna `usuario` + `where` | **Um banco por pessoa** |
|---|---|---|
| Migração do schema | todas as tabelas, todas as chaves primárias | nenhuma: `001_initial.sql` aplica igual em cada Neon |
| Como vaza | um `where` esquecido em 1 das ~20 funções do `repo.py` | não tem esse caminho: a conexão é o escopo |
| Custo | um Postgres | um Postgres por pessoa (o free tier do Neon basta) |
| Quem paga a API | de quem hospeda, salvo accounting extra | de cada um: a chave é parte da credencial |

Escolhemos o segundo. O `check (id = 1)` do `perfil`, que era limitação, passa a
ser a modelagem **correta** por tenant.

### O `ContextVar` não é preciosismo

O usuário ativo viaja num `contextvars.ContextVar` (`src/investai/tenants.py`),
não numa variável global. A razão é concreta: os handlers do FastAPI são `def`
síncrono, então o framework os executa num **threadpool**. Com uma global, duas
mensagens no mesmo segundo fazem a thread A escrever a URL do Kaua, a thread B
sobrescrever com a do Ricardo, e a query da thread A sair no banco do Ricardo.

Medido com 16 threads entrelaçadas por uma barreira: a versão com global vaza em
**8 delas**; a com `ContextVar`, em nenhuma. O teste que fixa isso é
`tests/test_tenants.py::test_escopo_nao_vaza_entre_threads_concorrentes`.

Dois corolários no código:

- o tenant é resolvido **dentro** do `_processar`, não no handler que recebe o
  POST: `BackgroundTasks` executa noutro contexto, e um `ContextVar` setado
  fora não atravessaria;
- o pool do psycopg virou `dict[tenant, ConnectionPool]`. Um pool com a URL
  trocada entre mensagens teria exatamente o mesmo problema da global.

### Fora de escopo é erro, não fallback

Com registro configurado, `repo.url()` devolve `None` e `tenants.ativo_ou_padrao()`
levanta quando não há usuário ativo. A alternativa — cair no `DATABASE_URL` do
`.env` — mandaria a operação para o banco de quem hospeda. Falhar alto é o
desfecho correto: o único inaceitável é responder com a carteira de alguém que
não pediu nada.

A mesma regra vale para a chave da API: `config.anthropic_key()` **não** cai na
chave do `.env` quando há usuário ativo. Se o registro de alguém ficar sem
chave, a rota de IA diz "não configurada" em vez de gastar o crédito de outra
pessoa.

### O que o bot compartilhado realmente economiza

Cada pessoa precisa, de qualquer forma, do próprio Neon e da própria chave da
Anthropic. O que o compartilhamento poupa é **o chip de WhatsApp e a VM** — e o
chip dedicado para o Baileys é a parte genuinamente chata de montar. Em troca,
quem hospeda passa a guardar as connection strings dos outros: um
comprometimento da VM atinge as três carteiras, não uma. É uma troca
consciente, não um detalhe.

---

## Limitações conhecidas

- **yfinance é uma biblioteca não oficial.** Pode mudar de formato, devolver campos
  ausentes ou bloquear por IP em rajadas. O código trata todos esses casos, mas a
  disponibilidade não está sob nosso controle.
- **Fundamentals da B3 vêm esparsos.** Vários campos chegam como `None` para papéis
  menos líquidos; o prompt só inclui o que realmente existe.
- **O RSS do Google Notícias é um feed público, não uma API contratada** — não tem SLA,
  pode mudar de formato e não traz resumo do texto (só manchete, veículo e data). Se ele
  falhar, o sistema cai para a Currents (quando há chave) e, no limite, segue sem notícias.
- **A Currents no plano gratuito** tem cobertura irregular em português e relevância fraca
  (ver a comparação acima) — por isso virou reserva, não fonte primária.
- **Cada briefing custa créditos** da API Anthropic. Não há geração automática.
- **Sem dados intraday nem backtesting.** O foco é o fechamento diário e a leitura semanal.
- **A carteira sugerida sai de um universo curado de 38 ativos**, não da B3 inteira: o
  yfinance não oferece lista confiável de tickers e varrer centenas de papéis geraria
  bloqueio por IP. Ativos fora do universo podem ser adicionados à mão no onboarding.
- **Renda fixa não tem cotação no sistema.** A camada de reserva aparece como valor em
  reais (Tesouro Selic / CDB de liquidez diária), sem acompanhamento de preço.
- **O questionário não substitui um planejador financeiro.** Ele cobre as dimensões de
  suitability, mas não conhece seu patrimônio total, situação tributária, dependentes,
  previdência ou imóveis.
- **Cache de 1 hora:** dados podem estar até 1 h desatualizados; use **Atualizar Dados**
  para forçar a rebusca.
