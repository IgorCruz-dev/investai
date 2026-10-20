# 📈 InvestAI

[![CI](https://github.com/IgorCruz-dev/investai/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorCruz-dev/investai/actions/workflows/ci.yml)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Code style: ruff](https://img.shields.io/badge/lint-ruff-261230.svg)](https://docs.astral.sh/ruff/)

**Assistente de investimentos que lê a sua carteira, busca dados reais de
mercado e notícias, calcula os indicadores localmente e usa o Claude para
escrever um briefing fundamentado em português.**

Três interfaces para o mesmo sistema: um **dashboard Streamlit** local, uma
**interface web** publicada na Vercel e um **assistente no WhatsApp** que
também registra as suas movimentações por conversa.

<a name="aviso"></a>
> ### ⚠️ Aviso
> Conteúdo **informativo e educacional**. Não é recomendação de investimento,
> não é consultoria e não substitui um profissional certificado. As decisões e
> os resultados são seus. O briefing é texto gerado por um modelo de
> linguagem a partir de dados públicos: **confira antes de agir**.
### Escopo: uma carteira por pessoa, não uma plataforma

Roda de dois jeitos, e a diferença é só configuração:

- **Instância pessoal** (o padrão) — você, a sua chave da Anthropic, o seu
  banco, o seu número. Nada a configurar além do `.env`.
- **Compartilhado entre poucas pessoas** — um bot e um painel para um grupo
  pequeno, onde **cada pessoa tem o próprio banco** e a própria chave da API. O
  bot diferencia pelo telefone, o painel pelo login. Veja
  [Várias pessoas na mesma instância](docs/deploy.md#46-várias-pessoas-na-mesma-instância).

O que o projeto **não** é: uma plataforma com cadastro aberto. Não há criação
de conta, cobrança, nem carteira de terceiros num banco só — quem entra, entra
porque alguém colocou as credenciais dessa pessoa no registro. É o que mantém o
sistema simples, barato e com os dados de cada um na infraestrutura dele.

Quer usar? Veja [Instalação](#instalação). Quer contribuir? Veja
[CONTRIBUTING.md](CONTRIBUTING.md).

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

## Onboarding

Na primeira execução (ou clicando em **Refazer onboarding**), o sistema pergunta
antes de analisar:

**"Você já tem carteira ativa?"**

- **Sim** → você seleciona os ativos, informa cotas e preço médio pago, e isso
  vira sua carteira real (com P&L).
- **Não** → um questionário de perfil de 18 perguntas, em 4 etapas (reserva de
  emergência, dívidas, horizonte, liquidez, reação a uma queda de 30%,
  experiência) → **carteira sugerida**, que pode ser adotada como *carteira
  planejada* (sem preço de compra, sem P&L inventado).

O resultado é um perfil (conservador, moderado ou arrojado), uma alocação-alvo
por classe de ativo e os **pré-requisitos** que vêm antes de comprar qualquer
ação: quitar dívida de juros altos e montar a reserva de emergência. Enquanto
eles não estiverem resolvidos, o sistema diz isso em vez de sugerir compra.

Sem `ANTHROPIC_API_KEY`, a carteira sugerida sai completa pelo caminho
determinístico.

> Por que 18 perguntas, de onde elas vêm e como a sugestão é montada:
> [docs/design.md](docs/design.md).

---

## Instalação

Requer **Python 3.12+** (os pins de numpy e pandas não têm build para 3.11).

```bash
# 1. Clone
git clone https://github.com/IgorCruz-dev/investai.git
cd investai

# 2. Ambiente virtual (o Python do sistema pode não ter pip; o venv traz o seu)
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 3. O pacote, em modo editável, com a interface local (versões fixadas)
pip install -e ".[dashboard]"
#   pip install -e .               # só o núcleo: WhatsApp, análise e dados
#   pip install -e ".[dashboard,dev]"   # + pytest e ruff, para contribuir

# 4. Chaves de API
cp .env.example .env
# edite .env e preencha ANTHROPIC_API_KEY e (opcionalmente) CURRENTS_API_KEY
```

### Chaves de API

| Variável | Para quê | Obrigatória? | Onde obter |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Gerar o briefing semanal (Aba 3) | Só para a Aba 3 | https://console.anthropic.com/settings/keys |
| `CURRENTS_API_KEY` | Fonte **de reserva** de notícias | Não | https://currentsapi.services/en/register (plano gratuito) |

As notícias vêm por padrão do **RSS do Google Notícias**, que não precisa de
chave e busca pelo ticker — então a Aba 4 funciona sem configurar nada. Sem `ANTHROPIC_API_KEY`, as
abas 1, 2 e 4 funcionam normalmente e o botão de briefing fica desabilitado com
um aviso explicando o que falta.

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

---

## Testes

```bash
pytest -m "not network"   # suíte offline
pytest                    # completa — bate nas APIs reais de propósito
```

Detalhes da convenção (o que pula e o que falha) estão no
[CONTRIBUTING.md](CONTRIBUTING.md#testes).

---

## Arquitetura

Layout `src/`: o pacote é `investai`, instalável com `pip install -e .` — é o
que põe os módulos no caminho de import do systemd, do cron e dos testes sem
gambiarra de `PYTHONPATH`. Estado do usuário (`.env`, `config/`, `cache/`) mora
**fora** do pacote, de propósito.

```
investai/
├── main.py                           # entry point do Streamlit
├── pyproject.toml                    # pacote, dependências fixadas, pytest, ruff
├── src/investai/                     # ── o pacote ──────────────────────────
│   ├── config.py                     # .env, carteira (Postgres ou JSON), constantes
│   ├── snapshot.py                   # monta o snapshot que a interface web consome
│   ├── data/
│   │   ├── repo.py                   # acesso ao Postgres (psycopg)
│   │   ├── market_data.py            # yfinance: preços + fundamentals
│   │   └── news_fetcher.py           # Google Notícias (RSS) + Currents de reserva
│   ├── analysis/
│   │   ├── quantitative.py           # médias, RSI de Wilder, métricas da carteira
│   │   ├── screener.py               # filtro quantitativo do universo da B3
│   │   ├── recommender.py            # carteira sugerida
│   │   ├── asset_analysis.py         # análise de um papel em UMA chamada, sem ferramentas
│   │   ├── briefing.py               # montagem do briefing (devolve o uso de tokens)
│   │   └── llm_analyst.py            # contexto com orçamento + chamada ao Claude
│   ├── portfolio/
│   │   └── writes.py                 # parsing, validação em camadas, confirmação
│   ├── agent/
│   │   ├── tools.py                  # 8 ferramentas — também chamadas direto, sem LLM
│   │   └── assistant.py              # agente com ferramentas (só no /pergunta)
│   ├── onboarding/                   # questionário de 18 perguntas e perfil
│   ├── utils/                        # resiliência, cache, formatação pt-BR, tickers
│   ├── whatsapp/                     # assistente no WhatsApp
│   │   ├── app.py                    # FastAPI: mensagens, cron do briefing, /health
│   │   ├── router.py                 # resolução de intenção — pura, sem I/O
│   │   ├── actions.py                # execução das intenções
│   │   ├── onboarding_chat.py        # as 18 perguntas por conversa
│   │   ├── store.py                  # SQLite: conversas, idempotência, gastos, sessão
│   │   └── bridge_client.py          # fala com a ponte Baileys
│   └── dashboard/                    # Streamlit: 4 abas + onboarding
├── apps/                             # ── aplicações JS autônomas ───────────
│   ├── web/                          # interface publicada na Vercel
│   │   ├── index.html, styles.css, app.js
│   │   └── api/                      # funções serverless (login, snapshot, movimento, jobs)
│   └── bridge/                       # ponte Node ↔ WhatsApp (Baileys)
├── scripts/                          # ── operação ──────────────────────────
│   ├── migrate_to_postgres.py        # aplica o esquema e semeia o catálogo
│   ├── publish_snapshot.py           # cron: calcula e publica o que a web lê
│   ├── process_jobs.py               # cron: executa o que a web pede
│   ├── export_snapshot.py            # grava apps/web/data.js (uso local, sem banco)
│   ├── run-local.sh                  # sobe servidor + ponte nesta máquina
│   └── fetch-qr.sh                   # baixa o QR de pareamento da VM
├── deploy/
│   ├── sql/001_initial.sql           # esquema do Postgres + replay do ledger (trigger)
│   ├── install.sh, update-vm.sh      # instalação e atualização da VM
│   └── *.service, crontab.example    # serviços e agendamentos
├── config/                           # carteira e perfil (espelho local, fora do git)
├── docs/                             # deploy.md e exemplos
└── tests/                            # pytest (rede real + offline)
```

> As escolhas de construção por trás dessa estrutura estão em
> [docs/design.md](docs/design.md).

---

## Assistente no WhatsApp

O mesmo sistema, acessível por conversa — e agora ele **escreve**, não só lê.

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

### Registrando compra e venda

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

Nada é gravado na primeira mensagem. A validação acontece em camadas:

1. **formato e faixa** — quantidade > 0, preço > 0, data não futura;
2. **posição disponível** — vender 150 de uma posição de 100 é recusado;
3. **existência no mercado** — o ticker precisa responder no yfinance;
4. **sanidade do preço** — 50% fora do mercado vira *aviso destacado*, não
   recusa: preço fora do mercado é suspeito, não impossível. É o que pega
   `35,50` digitado como `3550`.

### Onboarding por conversa

As mesmas 18 perguntas do dashboard, uma por mensagem, com `voltar`, `?` para
explicar e `cancelar`. Dá para parar no meio e voltar depois — o estado fica em
SQLite com validade de 2 horas, e o fluxo inteiro **não consome crédito de
API**.

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

**Como rodar:** veja [docs/deploy.md](docs/deploy.md).

```bash
./scripts/run-local.sh          # sobe servidor + ponte (mostra o QR na primeira vez)
./scripts/run-local.sh parar    # encerra os dois
curl -s localhost:8000/health | jq
```

---

## Interface web — acessível de qualquer lugar

A interface em `apps/web/` (HTML/CSS/JS puro, gráficos em SVG escritos à mão,
zero bibliotecas) é publicada na **Vercel**, protegida por senha, e lê e escreve
o mesmo banco que o assistente do WhatsApp.

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

Indicadores e notícias são calculados pela VM e publicados a cada 30 minutos;
carteira e extrato vêm **ao vivo** do banco, então a compra que você registra
aparece na hora. Quando o preço de um ativo recém-comprado ainda não foi
buscado, a tela diz isso em vez de contá-lo como zero.

### Autenticação

Uma senha só, porque o sistema é de uma pessoa só. A senha não é armazenada —
fica um hash PBKDF2-SHA256 em variável de ambiente da Vercel — e a sessão é um
cookie assinado (`HttpOnly; Secure; SameSite=Lax`) de 30 dias, com bloqueio
após dez erros em quinze minutos.

### Rodando local

```bash
# Com banco: a interface completa, igual à publicada
.venv/bin/python scripts/publish_snapshot.py
cd apps/web && npm install && vercel dev

# Sem banco: snapshot estático em arquivo
.venv/bin/python scripts/export_snapshot.py --demo
cd apps/web && python3 -m http.server 8777
```

| Arquivo | Papel |
|---|---|
| `index.html` | Estrutura, 5 abas, tela de senha e formulário de movimentação |
| `styles.css` | Tema único: tokens de cor, glassmorphism, orbs de luz |
| `app.js` | Render, gráficos em SVG, CRUD do extrato, sessão |
| `src/investai/snapshot.py` | Monta o snapshot (cron e CLI) |
| `api/*.js` | Funções serverless: login, snapshot, movimento, fila |

Tipografia: Instrument Serif (display), Manrope (interface) e IBM Plex Mono
(números). Respeita `prefers-reduced-motion`.

---

## Banco de dados

`movimentacoes` é a verdade; `posicoes` é derivada dela por replay, feito por
um trigger em PL/pgSQL (`deploy/sql/001_initial.sql`). Corrigir uma movimentação
de três meses atrás recalcula o preço médio sozinho.

| Tabela | Guarda |
|---|---|
| `movimentacoes` | Toda compra, venda e ajuste — editável e removível |
| `posicoes` | Materialização do replay: cotas, preço médio, resultado realizado |
| `ativos` | Catálogo (38 do universo curado + o que você comprar), com conferência |
| `perfil` | Respostas do questionário e o perfil derivado |
| `snapshots` | O que a web lê; os 30 mais recentes |
| `jobs` | Fila do que a web pede e a VM executa |


**Sem `DATABASE_URL`**, `load_portfolio()` lê `config/portfolio.json` como
sempre leu — é o modo offline, e é o que os testes usam. Toda escrita no banco
espelha o arquivo, que serve de backup legível e de leitura degradada se o Neon
estiver fora.

---

## Contribuindo

PRs são bem-vindos. O [CONTRIBUTING.md](CONTRIBUTING.md) tem o ambiente em
quatro comandos, o que o CI exige e as convenções que o código segue — a mais
importante delas: **o modelo não decide nada que o Python possa decidir**. As
decisões de construção, com as medições por trás delas, estão em
[docs/design.md](docs/design.md).

```bash
pip install -e ".[dashboard,dev]"
ruff check .              # lint
pytest -m "not network"   # 414 testes offline, o que o CI roda
pytest                    # suíte completa, bate nas APIs reais (~12 min)
```

Bug ou ideia? [Abra uma issue](https://github.com/IgorCruz-dev/investai/issues/new/choose).
Vulnerabilidade de segurança? Use uma
[advisory privada](https://github.com/IgorCruz-dev/investai/security/advisories/new),
não uma issue pública.

## Licença

[MIT](LICENSE) — © 2026 Igor Cruz.

Dependências de terceiros mantêm as suas próprias licenças. O **yfinance** é
uma biblioteca não oficial que raspa dados do Yahoo Finance: confira os termos
de uso do Yahoo antes de qualquer utilização comercial.
