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
├── main.py                       # entry point do Streamlit
├── config/
│   ├── portfolio.json            # sua carteira (gravada pelo onboarding)
│   ├── portfolio.exemplo.json    # modelo de preenchimento manual
│   └── profile.json              # perfil do investidor (gerado no onboarding)
├── cache/data_cache.json         # cache em disco (TTL de 1 hora)
├── src/
│   ├── config.py                 # .env, carteira e constantes de tuning
│   ├── data/
│   │   ├── market_data.py        # yfinance: preços + fundamentals (cache → throttle → retry)
│   │   └── news_fetcher.py       # Google Notícias (RSS) + Currents como reserva
│   ├── agent/
│   │   ├── tools.py              # 8 ferramentas do Claude sobre os módulos do sistema
│   │   └── assistant.py          # laço de conversa, histórico, custo
│   ├── onboarding/
│   │   ├── questionnaire.py      # 18 perguntas (5 da AUVP + suitability)
│   │   └── profile.py            # score de risco, pré-requisitos, alocação-alvo
│   ├── analysis/
│   │   ├── quantitative.py       # médias, RSI de Wilder, variações, métricas da carteira
│   │   ├── screener.py           # filtro quantitativo do universo da B3
│   │   ├── recommender.py        # carteira sugerida (regra + Claude com saída estruturada)
│   │   └── llm_analyst.py        # montagem do contexto + chamada ao Claude
│   └── utils/
│       ├── resilience.py         # retry/backoff, throttle entre threads, blindagem
│       ├── cache.py              # cache JSON atômico com TTL
│       └── formatters.py         # formatação pt-BR (usada no prompt e na UI)
├── dashboard/
│   ├── app.py                    # orquestração, sidebar e abas
│   └── components/               # onboarding, portfolio_view, charts, briefing_view, news_view
├── server/                       # assistente no WhatsApp
│   ├── app.py                    # FastAPI: mensagens, cron do briefing, /health
│   ├── bridge_client.py          # fala com a ponte Baileys
│   ├── store.py                  # SQLite: conversas, idempotência, gastos
│   └── config.py                 # variáveis de ambiente do servidor
├── bridge/                       # ponte Node ↔ WhatsApp (Baileys)
├── deploy/                       # systemd, cron e script de instalação
└── tests/                        # pytest (rede real + offline)
```

### Decisões de projeto

- **Nada estoura na cara do usuário.** Toda função de I/O é blindada (`@safe`) e devolve
  valor padrão — DataFrame vazio, `{}` — com log claro. Indicador que não pôde ser
  calculado vira `None` e aparece como **N/D** na interface, nunca como número inventado.
- **Resiliência num só lugar.** `retry` com backoff exponencial (3 tentativas), `Throttle`
  com relógio compartilhado sob lock (um `sleep` solto não funcionaria dentro do
  `ThreadPoolExecutor`) e cache em disco com escrita atômica.
- **RSI pela definição de Wilder.** A inicialização usa a média simples dos 14 primeiros
  ganhos/perdas antes da suavização recursiva; usar `ewm` desde o primeiro delta erra o
  valor em séries curtas. Validado contra a série de referência clássica (70,46 / 57,92).
- **Contexto do LLM filtrado e com orçamento.** O prompt leva apenas carteira,
  indicadores já calculados, fundamentals disponíveis e até 5 notícias por ativo. Se
  passar do orçamento de tokens, as notícias são podadas antes dos fundamentos — a
  carteira e os indicadores nunca saem.
- **Streaming na chamada do Claude.** É o caminho recomendado para `max_tokens` alto:
  evita timeout de HTTP em briefings longos.

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

---

## Assistente no WhatsApp

O mesmo sistema, acessível por conversa. O Claude recebe **8 ferramentas** sobre
os módulos que já existem e decide quais usar a cada pergunta:

| Ferramenta | O que faz |
|---|---|
| `consultar_carteira` | Posições, valor, P&L e pesos |
| `analisar_ativo` | Técnico + fundamentos de um papel |
| `cotacao` | Preço e variação de vários ativos |
| `buscar_noticias` | Notícias da semana, por ativo ou da carteira |
| `gerar_briefing` | Briefing semanal completo |
| `recomendar_carteira` | Sugestão a partir do perfil salvo |
| `status_do_perfil` | Perfil, reserva e alocação-alvo |
| `data_de_hoje` | Contexto temporal |

```
você:  analisa a PETR4 pra mim
bot:   *PETR4 — R$ 56,85* (tendência de alta)
       - Subiu forte: +16,0% em 30d, +40,1% em 90d e +88,1% em 12 meses.
       - Preço acima de todas as médias (MM20 50,97 · MM50 46,91 · MM200 42,48).
       - *RSI em 76*, acima de 70: sobrecomprado.
```

### Topologia

```
Seu WhatsApp → chip dedicado → ponte Baileys (Node) → servidor (Python) → Claude
```

A conexão é via **Baileys** (dispositivo vinculado, como o WhatsApp Web), não
pela Cloud API da Meta. Isso significa: sem cadastro na Meta, sem webhook
público, sem domínio, sem HTTPS, sem template e sem janela de 24 horas — só
conexões de saída e dois serviços conversando por `127.0.0.1`.

**Como rodar:** veja [DEPLOY.md](DEPLOY.md) — da VM na Oracle ao pareamento do
QR, com custo de infraestrutura zero.

```bash
./rodar.sh          # sobe servidor + ponte (mostra o QR na primeira vez)
./rodar.sh parar    # encerra os dois
curl -s localhost:8000/health | jq
```

O script confere o que falta antes de subir (número configurado, chave da
Anthropic, dependências da ponte) — em vez de falhar vinte minutos depois.

### Decisões que importam

- **Tool Runner do SDK** (`client.beta.messages.tool_runner`) executa o ciclo
  pedido → ferramenta → resposta. O histórico é espelhado e persistido em SQLite,
  então a conversa continua entre mensagens.
- **Cache de prompt**: as definições das ferramentas + system prompt somam ~4 mil
  tokens reenviados a cada mensagem. Cacheados, o custo por mensagem cai de
  US$ 0,025 para **US$ 0,006**.
- **202 imediato na ponte**: o agente leva de 5 a 60 segundos, então o
  processamento vai para segundo plano em vez de segurar a conexão. Cada
  `message_id` é processado uma única vez.
- **Lista branca de números** e **teto de gasto mensal**: sem os dois, qualquer
  um que descubra o número consome seus créditos.
- **Formato de celular**: o system prompt proíbe markdown que o WhatsApp não
  renderiza (tabela, `#`, link em colchetes) e pede respostas de 2 a 8 linhas.

---

## Dashboard web (HTML/CSS/JS)

Além do app Streamlit, há uma interface própria em `dashboard/web/` — dark
glassmorphism com acentos dourados, sem nenhuma dependência de biblioteca
externa (os gráficos são SVG escritos à mão).

```bash
# Gera o snapshot com dados reais de mercado
.venv/bin/python dashboard/web/scripts/export_snapshot.py

# Serve a interface
cd dashboard/web && python3 -m http.server 8777
# abra http://127.0.0.1:8777
```

| Arquivo | Papel |
|---|---|
| `index.html` | Estrutura e as 4 abas (linkáveis por hash: `#overview`, `#technical`, `#briefing`, `#news`) |
| `styles.css` | Tema único e deliberado: tokens de cor, glassmorphism, orbs de luz, animações |
| `app.js` | Render dos dados, gráficos em SVG (área, candlestick, RSI), markdown do briefing |
| `data.js` | Snapshot gerado pelo script — preços, indicadores, notícias e briefing reais |
| `scripts/export_snapshot.py` | Busca os dados e grava `data.js` |

**É uma interface estática**: lê o snapshot gerado pelo script, não chama as APIs
ao vivo. O botão "Gerar briefing" exibe o briefing que já está no snapshot; no app
Streamlit o mesmo botão dispara a chamada real ao Claude.

Tipografia: Instrument Serif (display), Manrope (interface) e IBM Plex Mono
(números) — via Google Fonts, com fallback declarado. Respeita
`prefers-reduced-motion`: com animação reduzida, tudo aparece no estado final.
