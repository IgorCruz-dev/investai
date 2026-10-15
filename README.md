# 📈 InvestAI — Personal Investment Intelligence Agent

Sistema que lê a sua carteira, busca **dados reais** de mercado e notícias, calcula
indicadores técnicos localmente e usa o **Claude** para gerar um briefing semanal
em português com recomendações fundamentadas — tudo exibido num dashboard Streamlit.

> ⚠️ Conteúdo informativo e educacional. **Não é recomendação de investimento.**

---

## O que o sistema faz

| Etapa | Como |
|---|---|
| 0. Onboarding | Questionário de perfil (18 perguntas) → carteira existente **ou** carteira sugerida |
| 1. Carteira | Vem do onboarding, ou editada à mão em `config/portfolio.json` |
| 2. Dados de mercado | Histórico OHLCV e fundamentals via **yfinance** (B3 com sufixo `.SA` e mercado americano) |
| 3. Notícias | Últimos 7 dias via **Google Notícias (RSS)** — busca pelo ticker, sem chave; **Currents API** como reserva |
| 4. Análise quantitativa | Médias móveis 20/50/200, RSI(14) de Wilder, variações 7d/30d/90d/1a, volatilidade anualizada, sinal de tendência |
| 5. Análise qualitativa | **Claude** (`claude-opus-5`) recebe só o contexto filtrado e escreve o briefing |
| 6. Dashboard | Streamlit com 4 abas: Carteira, Análise Técnica, Briefing Semanal, Notícias |
| 7. WhatsApp | Assistente conversacional com as ferramentas acima — pergunte de qualquer lugar |

## Onboarding: perfil antes de carteira

Na primeira execução (ou clicando em **Refazer onboarding**), o sistema pergunta
antes de analisar:

1. **"Você já tem carteira ativa?"**
   - **Sim** → você seleciona os ativos, informa cotas e preço médio pago, e isso
     vira sua carteira real (com P&L).
   - **Não** → questionário de perfil → **carteira sugerida**, que pode ser
     adotada como *carteira planejada* (sem preço de compra, sem P&L inventado).

2. **O questionário (18 perguntas, 4 etapas)** combina duas origens:
   - **5 perguntas do diagnóstico da AUVP (Raul Sena)**: nota honesta para a
     situação financeira atual, comprometimento com os objetivos, prioridade dos
     próximos 12 meses, nível de conhecimento e faixa de renda. *(O formulário
     original tem 14 campos, mas 9 são captação de lead — nome, WhatsApp, "como
     descobriu", disposição de pagar o curso — e não dizem nada sobre perfil.)*
   - **As dimensões de suitability** que a regulação brasileira exige e que
     faltavam ali: reserva de emergência, dívidas de juros altos, custo de vida,
     capacidade de aporte, horizonte, necessidade de liquidez, estabilidade de
     renda, reação a uma queda de 30% e experiência com produtos.

3. **Ordem antes de otimização.** O sistema não pula direto para "compre estas
   ações". A sequência é: dívida de juros altos → reserva de emergência (6 meses
   de despesas) → diversificação ampla via ETF → ativos individuais. Quem declara
   dívida de cartão recebe um bloqueio explícito, porque quitá-la rende mais, com
   certeza, do que qualquer carteira de ações.

4. **Como a carteira sugerida é montada** (três etapas separadas de propósito):
   | Decisão | Quem decide | Como |
   |---|---|---|
   | Quanto em cada classe | `src/onboarding/profile.py` | Regra determinística sobre o questionário (score de risco 0-100 → perfil → alocação, com ajustes por horizonte, liquidez e objetivo) |
   | Quais ativos podem entrar | `src/analysis/screener.py` | Filtro quantitativo sobre 38 ativos líquidos da B3, com dados reais: liquidez mínima, P/L, dívida/patrimônio, dividend yield, volatilidade e tendência |
   | Pesos e justificativa | `src/analysis/recommender.py` + Claude | O Claude distribui os pesos **dentro** das classes e explica cada escolha citando o dado. Se sugerir ticker fora da lista aprovada ou furar o peso da classe, a resposta é descartada e vale o rateio determinístico |

   O LLM nunca escolhe um ativo que o filtro reprovou nem muda a alocação por
   classe — e, sem `ANTHROPIC_API_KEY`, a recomendação sai completa pelo caminho
   determinístico.

5. **Teto para iniciante.** Horizonte longo infla o score de risco com
   facilidade. Quem se declara iniciante e nunca comprou ativo de risco não é
   classificado como arrojado, porque tolerância a queda só se comprova vivendo
   uma — o sistema explica o teto na tela.

---

## Instalação

Requer **Python 3.11+** (testado em 3.12).

```bash
cd investai

# 1. Ambiente virtual (o Python do sistema pode não ter pip; o venv traz o seu)
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2. Dependências (versões fixadas)
pip install -r requirements.txt

# 3. Chaves de API
cp .env.example .env
# edite .env e preencha ANTHROPIC_API_KEY e (opcionalmente) CURRENTS_API_KEY
```

### Chaves de API

| Variável | Para quê | Obrigatória? | Onde obter |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Gerar o briefing semanal (Aba 3) | Só para a Aba 3 | https://console.anthropic.com/settings/keys |
| `CURRENTS_API_KEY` | Fonte **de reserva** de notícias | Não | https://currentsapi.services/en/register (plano gratuito) |

As notícias vêm por padrão do **RSS do Google Notícias**, que não precisa de
chave — então a Aba 4 funciona sem configurar nada. Sem `ANTHROPIC_API_KEY`, as
abas 1, 2 e 4 funcionam normalmente e o botão de briefing fica desabilitado com
um aviso explicando o que falta.

### Por que Google Notícias e não a Currents

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

## Uso

```bash
streamlit run main.py
```

O dashboard abre em `http://localhost:8501`.

- **🔄 Atualizar Dados** (barra lateral) limpa o cache e rebusca tudo.
- **Gerar Briefing** (Aba 3) é um clique explícito porque **consome créditos da API** —
  nunca roda automaticamente.
- A barra lateral mostra o status de cada API em verde/vermelho e o horário da última busca.

### Editando a carteira à mão

O onboarding grava este arquivo, mas você pode editá-lo direto —
`config/portfolio.exemplo.json` tem um modelo com ação, ETF, FII e ativo
americano. `config/portfolio.json`:

```json
{
  "portfolio": [
    {"ticker": "PETR4.SA", "shares": 100, "avg_price": 35.50},
    {"ticker": "VALE3.SA", "shares": 50,  "avg_price": 68.00},
    {"ticker": "AAPL",     "shares": 10,  "avg_price": 180.00}
  ],
  "currency": "BRL",
  "last_updated": "2026-10-12"
}
```

Papéis da B3 usam o sufixo `.SA`; ações americanas vão sem sufixo. Uma posição
malformada é ignorada com aviso — as outras continuam funcionando.

---

## Configuração opcional

Tudo no `.env` (os valores abaixo são os padrões):

```bash
INVESTAI_MODEL=claude-opus-5     # modelo do briefing
INVESTAI_EFFORT=medium           # low | medium | high | xhigh | max
INVESTAI_MAX_TOKENS=16000        # tamanho máximo do briefing
INVESTAI_LLM_TIMEOUT=120         # segundos até desistir da geração
INVESTAI_CONTEXT_BUDGET=8000     # orçamento de tokens do contexto enviado
INVESTAI_PERIOD=1y               # histórico buscado (1mo, 6mo, 1y, 5y...)
INVESTAI_CACHE_TTL=3600          # validade do cache, em segundos
INVESTAI_YF_INTERVAL=0.5         # intervalo mínimo entre chamadas yfinance
INVESTAI_MAX_WORKERS=4           # paralelismo das buscas
```

> **Por que não existe `temperature`:** a geração Opus 5 **removeu** esse parâmetro
> da API (enviá-lo devolve HTTP 400). O rigor factual vem do system prompt — que
> exige citar o dado que embasou cada conclusão — e de `INVESTAI_EFFORT`.

---

## Testes

```bash
pytest                 # suíte completa (bate nas APIs reais)
pytest -m "not network"  # só os testes offline (matemática, parsing, resiliência)
pytest -m paid         # inclui o teste que gasta créditos da API (desativado por padrão)
```

Os testes usam as **APIs reais** de propósito: mock de dado de mercado daria uma
falsa sensação de segurança. Para que isso seja sustentável, a suíte separa os dois
tipos de falha:

- **API indisponível** (sem internet, rate limit, Yahoo fora) → o teste é **pulado**, com o motivo;
- **contrato quebrado** (coluna faltando, exceção escapando, tipo errado) → o teste **falha**.

---

## Arquitetura

```
investai/
├── main.py                       # entry point do Streamlit (interface local)
├── config/
│   ├── portfolio.json            # espelho da carteira (a verdade está no Postgres)
│   └── profile.json              # espelho do perfil
├── deploy/
│   ├── sql/001_inicial.sql       # esquema do Postgres + replay do ledger (trigger)
│   ├── systemd + crontab.txt     # serviços e agendamentos da VM
│   └── instalar.sh
├── scripts/
│   ├── migrar_para_pg.py         # aplica o esquema e semeia o catálogo
│   ├── publicar_snapshot.py      # cron: calcula e publica o que a web lê
│   └── processar_jobs.py         # cron: executa o que a web pede
├── src/
│   ├── config.py                 # .env, carteira (Postgres ou JSON), constantes
│   ├── data/
│   │   ├── repo.py               # acesso ao Postgres (psycopg)
│   │   ├── market_data.py        # yfinance: preços + fundamentals
│   │   └── news_fetcher.py       # Google Notícias (RSS) + Currents de reserva
│   ├── portfolio/
│   │   └── escrita.py            # parsing, validação em camadas, confirmação
│   ├── agent/
│   │   ├── tools.py              # 8 ferramentas — também chamadas direto, sem LLM
│   │   └── assistant.py          # agente com ferramentas (só no /pergunta)
│   ├── onboarding/               # questionário e perfil
│   ├── analysis/
│   │   ├── quantitative.py       # médias, RSI de Wilder, métricas da carteira
│   │   ├── screener.py           # filtro quantitativo do universo da B3
│   │   ├── recommender.py        # carteira sugerida
│   │   ├── analise_ativo.py      # análise de um papel em UMA chamada, sem ferramentas
│   │   ├── briefing.py           # montagem do briefing (devolve o uso de tokens)
│   │   └── llm_analyst.py        # contexto com orçamento + chamada ao Claude
│   └── utils/                    # resiliência, cache, formatação pt-BR, tickers
├── server/                       # assistente no WhatsApp
│   ├── app.py                    # FastAPI: mensagens, cron do briefing, /health
│   ├── roteador.py               # resolução de intenção — pura, sem I/O
│   ├── acoes.py                  # execução das intenções
│   ├── onboarding_chat.py        # as 18 perguntas por conversa
│   ├── store.py                  # SQLite: conversas, idempotência, gastos, sessão
│   └── bridge_client.py          # fala com a ponte Baileys
├── bridge/                       # ponte Node ↔ WhatsApp (Baileys)
├── dashboard/
│   ├── app.py + components/      # Streamlit (interface local de desenvolvimento)
│   └── web/                      # interface publicada na Vercel
│       ├── index.html, styles.css, app.js
│       ├── snapshot.py           # monta o snapshot que a web consome
│       └── api/                  # funções serverless (login, snapshot, movimento, jobs)
└── tests/                        # pytest (rede real + offline)
```

### Decisões de projeto

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
- **Uma validação só.** `src/portfolio/escrita.py` é usado pelo WhatsApp e pela web; a
  regra mais profunda (não vender o que não se tem) mora no **banco**, onde nem um
  `psql` na mão passa por cima.

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

---

## Assistente no WhatsApp

O mesmo sistema, acessível por conversa — e agora ele **escreve**, não só lê.

### A regra de custo

Até aqui toda mensagem passava pelo agente, que carrega as definições de 8
ferramentas (~4 mil tokens) em cada requisição. A primeira mensagem de uma
conversa escreve esse prefixo no cache a 125% do preço de entrada: ~US$ 0,030
para responder "como está minha carteira?", cuja resposta é um `SELECT` e três
linhas de formatação.

Agora um roteador determinístico (`server/roteador.py`) resolve a intenção
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

### Comandos

Tudo abaixo entende linguagem natural; a barra é atalho, não obrigação.

| Comando | Também entende | IA? | Resposta |
|---|---|---|---|
| `/ajuda` | "ajuda", "oi", "menu" | não | Menu numerado de 10 itens |
| `/carteira` | "minha carteira", "quanto eu tenho", "meu patrimônio" | não | Total, P&L e uma linha por posição |
| `/cotacao PETR4 VALE3` | "quanto está a PETR4", "preço de VALE3" | não | Uma linha por ativo |
| `/comprei 100 PETR4 a 35,50` | "comprei …", com `em 12/10` opcional | não | Confirmação → grava |
| `/vendi 50 PETR4 a 60` | "vendi …" | não | Confirmação com P&L apurado → grava |
| `/ajustar PETR4 120 36,10` | "corrige a posição de PETR4" | não | Confirmação → grava |
| `/remover PETR4` | "remove PETR4 da carteira" | não | Confirmação citando o que se perde |
| `/extrato [PETR4]` | "movimentações", "histórico de compras" | não | Últimas 10, com `#id` |
| `/desfazer` | "apaga a última" | não | Confirmação → apaga |
| `/perfil` | "qual meu perfil" | não | Classificação, score, reserva |
| `/onboarding` | "refazer perfil", "questionário" | não | As 18 perguntas, por conversa |
| `/alocacao` | "o que falta", "reserva de emergência" | não | Alvo × real + pré-requisitos |
| `/sugestao` | "o que eu deveria comprar" | não | Carteira sugerida (determinística) |
| `/noticias [PETR4]` | "o que saiu sobre meus ativos" | não | Manchetes da semana |
| `/status` | "quanto gastei", "tá tudo no ar?" | não | Ponte, banco, gasto do mês |
| **`/analise PETR4`** | "analisa PETR4", "o que você acha de VALE3" | **sim** | Leitura do papel, ~US$ 0,02 |
| **`/briefing`** | "me manda o briefing" | **sim** | Confirma antes (~1 min, ~US$ 0,10) |
| **`/pergunta <texto>`** | — | **sim** | Agente com as 8 ferramentas |

O que não casa com nada vira **menu numerado** — nunca uma chamada de modelo.
Digitar o número executa o item.

### Escrita: o Python decide, não o modelo

```
você:  comprei 100 PETR4 a 35,50
bot:   *Compra* — confirma?
       100 PETR4 a R$ 35,50
       Total: R$ 3.550,00
       Mercado hoje: R$ 58,11

       Responda *sim* para gravar ou *não* para descartar.
você:  sim
bot:   Compra registrada. ✅  _#1_
       PETR4: 100 cotas, preço médio R$ 35,50
```

Nada é gravado na primeira mensagem. A validação acontece em camadas, da mais
barata para a mais cara (`src/portfolio/escrita.py`):

1. **formato e faixa** — quantidade > 0, preço > 0, data não futura;
2. **posição disponível** — vender 150 de uma posição de 100 é recusado aqui,
   com mensagem melhor, e **de novo** no banco, que é a rede de segurança;
3. **existência no mercado** — o ticker precisa responder no yfinance;
4. **sanidade do preço** — 50% fora do mercado vira *aviso destacado*, não
   recusa: preço fora do mercado é suspeito, não impossível. É o que pega
   `35,50` digitado como `3550`.

Se um dia o `/pergunta` sugerir uma compra, ele não grava: produz uma proposta
que entra no mesmo fluxo de confirmação. Nenhuma ferramenta de escrita é
exposta ao modelo.

### Onboarding por conversa

As mesmas 18 perguntas do dashboard, uma por mensagem, com `voltar`, `?` para
explicar e `cancelar`. Dá para parar no meio e voltar depois — o estado fica em
SQLite com validade de 2 horas. Zero chamadas de modelo em todo o fluxo: as 18
perguntas pelo agente custariam mais de US$ 0,50 para produzir o mesmo perfil.

### Topologia

```
Seu WhatsApp → chip dedicado → ponte Baileys (Node) → servidor (Python)
                                                           ↓
                                      roteador → ferramentas (custo zero)
                                               → Claude (só análise e briefing)
```

A conexão é via **Baileys** (dispositivo vinculado, como o WhatsApp Web), não
pela Cloud API da Meta: sem cadastro, sem webhook público, sem domínio, sem
HTTPS, sem template e sem janela de 24 horas.

**Como rodar:** veja [DEPLOY.md](DEPLOY.md).

```bash
./rodar.sh          # sobe servidor + ponte (mostra o QR na primeira vez)
./rodar.sh parar    # encerra os dois
curl -s localhost:8000/health | jq
```

### Decisões que importam

- **Reuso sem LLM.** As ferramentas em `src/agent/tools.py` são
  `BetaFunctionTool`, mas continuam sendo função Python chamável. O roteador as
  invoca direto — mesma formatação que já estava em produção, sem modelo no meio.
- **Resolução pura.** `roteador.resolver()` não toca em rede, banco nem modelo:
  olha o texto e a sessão e devolve a intenção. É isso que permite testar a
  tabela inteira offline e afirmar, com teste, que nenhuma rota barata chama a API.
- **Comando explícito vence vocabulário.** `/pergunta analisa PETR4` é pergunta
  livre, não análise — o que vem depois da barra é argumento.
- **Lista branca de números** e **teto de gasto mensal**, que agora só bloqueia
  as rotas de IA: travar a consulta de carteira porque o briefing estourou o
  orçamento seria punir o caminho que não custa nada.

---

## Interface web — acessível de qualquer lugar

O dashboard em `dashboard/web/` (HTML/CSS/JS puro, gráficos em SVG escritos à
mão, zero bibliotecas) deixou de ser um snapshot estático: agora é a interface
publicada na **Vercel**, com senha, lendo e escrevendo o mesmo banco que o
assistente do WhatsApp.

```
    Navegador (celular, notebook, qualquer lugar)
            │  HTTPS
            ▼
    Vercel ── estático + /api/* em funções Node
            │  senha única → cookie HMAC assinado
            ▼
    Neon Postgres ── posicoes · movimentacoes · ativos · perfil · snapshots · jobs
            ▲  só conexões de SAÍDA
            │
    VM Oracle ── FastAPI e ponte Baileys, ambos presos a 127.0.0.1
            ▼
    Seu WhatsApp
```

**A VM continua sem nada escutando na internet.** Nenhuma porta aberta, nenhum
túnel, nenhum domínio — era a propriedade mais valiosa do deploy anterior e foi
preservada tirando o estado de dentro dela. Vercel e VM nunca se falam: os dois
falam com o banco.

| | Vercel | VM |
|---|---|---|
| Interface, login, CRUD | ✅ | — |
| Carteira, extrato, perfil | ✅ lê e escreve | ✅ lê e escreve |
| yfinance, indicadores, RSI, notícias | ❌ | ✅ |
| Claude | ❌ | ✅ |

### O que a tela faz

- **Carteira** — valor, P&L, evolução de 12 meses e posições, com botões de
  registrar compra e venda;
- **Técnica** — candlestick, médias e RSI, em SVG;
- **Briefing** — o último publicado, com botão para pedir um novo;
- **Extrato** — todo o histórico, com editar e apagar. As posições são
  **derivadas** dele: corrigir uma linha de três meses atrás recalcula o preço
  médio sozinho;
- **Notícias** — manchetes da semana por ativo.

### Como os dados chegam

A web **não calcula indicador**. A VM publica um snapshot em `snapshots` a cada
30 minutos (cron), e a tela lê o último. Já carteira e extrato vêm **ao vivo**
do banco, porque mudam quando você registra uma compra — esperar meia hora para
ver a própria compra aparecer seria esquisito. Quando o preço de um ativo
recém-comprado ainda não foi buscado, a tela diz isso em vez de contá-lo como
zero.

Quando a web precisa de algo que só a VM faz (gerar briefing, conferir um
ticker novo no yfinance), ela insere uma linha em `jobs` e o cron da VM executa
na próxima passada. Fila por banco: sem webhook, sem porta aberta.

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

### Rodando local

```bash
# Com banco: a interface completa, igual à publicada
.venv/bin/python scripts/publicar_snapshot.py
cd dashboard/web && npm install && vercel dev

# Sem banco: snapshot estático em arquivo, como antes
.venv/bin/python dashboard/web/scripts/export_snapshot.py
cd dashboard/web && python3 -m http.server 8777
```

| Arquivo | Papel |
|---|---|
| `index.html` | Estrutura, 5 abas, tela de senha e formulário de movimentação |
| `styles.css` | Tema único: tokens de cor, glassmorphism, orbs de luz |
| `app.js` | Render, gráficos em SVG, CRUD do extrato, sessão |
| `snapshot.py` | Monta o snapshot (usado pelo cron e pelo CLI) |
| `api/*.js` | Funções serverless: login, snapshot, movimento, fila |

Tipografia: Instrument Serif (display), Manrope (interface) e IBM Plex Mono
(números). Respeita `prefers-reduced-motion`.

---

## Banco de dados

`movimentacoes` é a verdade; `posicoes` é derivada dela por replay, feito por
um trigger em PL/pgSQL (`deploy/sql/001_inicial.sql`).

| Tabela | Guarda |
|---|---|
| `movimentacoes` | Toda compra, venda e ajuste — editável e removível |
| `posicoes` | Materialização do replay: cotas, preço médio, resultado realizado |
| `ativos` | Catálogo (38 do universo curado + o que você comprar), com conferência |
| `perfil` | Respostas do questionário e o perfil derivado |
| `snapshots` | O que a web lê; os 30 mais recentes |
| `jobs` | Fila do que a web pede e a VM executa |

**Por que posição é derivada e não digitada.** O replay recomputa tudo a cada
escrita — para um ledger pessoal isso custa microssegundos, e elimina a classe
de bug em que um delta incremental deixa a posição torta para sempre sem
ninguém notar. Editar ou apagar uma movimentação corrige a posição sozinho, e
não existe caminho em que posição e histórico divirjam.

O preço médio pondera com as taxas dentro do custo — que é também o critério da
Receita para apurar ganho de capital, então o resultado realizado do extrato
serve para o imposto, não só para a tela.

Fica em **SQLite na VM** o que só o bot lê: conversas, idempotência, gastos e o
estado de sessão (confirmação pendente, onboarding em andamento). Uma ida ao
Postgres por mensagem custaria latência sem ninguém do outro lado precisar do dado.

**Sem `DATABASE_URL`**, `load_portfolio()` lê `config/portfolio.json` como
sempre leu — é o modo offline, e é o que os testes usam. Toda escrita no banco
espelha o arquivo, que serve de backup legível e de leitura degradada se o Neon
estiver fora.

---

