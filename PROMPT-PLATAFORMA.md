# Prompt para a nova sessão — InvestAI como plataforma multiusuário

> Copie tudo abaixo da linha e cole no novo chat.

---

Quero transformar o **InvestAI** — hoje uma ferramenta pessoal rodando numa VM — em uma **plataforma multiusuário**, com banco no Neon, deploy na Vercel, autenticação, onboarding e um bot de WhatsApp com custo controlado.

Antes de escrever qualquer código, leia o projeto em `~/dev/investai` e **me apresente um plano**. Há decisões de arquitetura nesta mudança que não são minhas de antemão — quero que você as levante, recomende um caminho e só depois implemente.

---

## 1. O que já existe (não jogue fora)

Projeto Python em `~/dev/investai`, git inicializado (4 commits), **170 testes passando** que batem em APIs reais de propósito. Rodando em produção numa VM da Oracle (`SEU_IP_DA_VM`, Ubuntu 24.04, 1 GB RAM + 3 GB swap, Always Free), com dois serviços no systemd.

**Núcleo de análise — é o ativo mais valioso do projeto, testado e funcionando:**

| Arquivo | Linhas | O que faz |
|---|---|---|
| `src/analysis/quantitative.py` | 295 | Médias móveis, RSI pela definição de Wilder (validado contra série de referência), variações 7d/30d/90d/1a, volatilidade anualizada, métricas e P&L da carteira |
| `src/analysis/screener.py` | 301 | Universo curado de 38 ativos líquidos da B3 (ações, ETFs, FIIs); filtro quantitativo por perfil: liquidez mínima, P/L, dívida/patrimônio, dividend yield, volatilidade, tendência. Devolve aprovados **e reprovados com o motivo** |
| `src/analysis/recommender.py` | 509 | Monta carteira sugerida: alocação determinística por classe → Claude distribui pesos **dentro** das classes e justifica citando o dado → validação descarta resposta que use ticker fora da lista ou fure o peso da classe. Cai no rateio determinístico se o LLM desviar |
| `src/analysis/llm_analyst.py` | 385 | Briefing semanal: monta contexto filtrado com orçamento de tokens, chama `claude-opus-5`, trata todos os caminhos de erro |
| `src/onboarding/questionnaire.py` | 259 | 18 perguntas em 4 etapas (5 do diagnóstico da AUVP + dimensões de suitability: reserva, dívida, horizonte, liquidez, reação a queda, experiência) |
| `src/onboarding/profile.py` | 366 | Score de risco 0-100 ponderado, classificação (Conservador/Moderado/Arrojado) com teto para iniciante, pré-requisitos bloqueantes (dívida cara e reserva **antes** da bolsa), alocação-alvo com ajustes por horizonte/liquidez/objetivo |
| `src/data/market_data.py` | 208 | yfinance com cache, throttle anti-bloqueio e retry com backoff; nunca levanta exceção |
| `src/data/news_fetcher.py` | 416 | Google Notícias (RSS, busca **pelo ticker** — descobrimos que buscar pelo nome traz futebol para "Vale") com Currents como reserva e filtro de relevância |
| `src/utils/` | ~400 | `resilience.py` (retry, throttle entre threads, blindagem), `cache.py` (JSON atômico com TTL), `formatters.py` (pt-BR) |

**Interfaces atuais:**
- `dashboard/` — app Streamlit com 4 abas e fluxo de onboarding
- `dashboard/web/` — dashboard estático em HTML/CSS/JS puro (dark glassmorphism dourado, gráficos em SVG escritos à mão, sem bibliotecas); lê um snapshot gerado por `scripts/export_snapshot.py`
- `src/agent/` (601 linhas) — 8 ferramentas do Claude + laço de conversa com histórico
- `server/` (436 linhas) — FastAPI, cliente da ponte, SQLite (conversas, idempotência, gastos)
- `bridge/` — ponte Node com Baileys (WhatsApp não oficial, dispositivo vinculado)

**Decisões já tomadas que devem ser respeitadas:**
- Modelo `claude-opus-5`. **Não existe `temperature` nessa geração** — enviar devolve HTTP 400. Rigor factual vem do system prompt + `output_config.effort`
- Notícias se buscam **pelo ticker**, não pelo nome da empresa
- O LLM nunca escolhe ativo fora da lista aprovada pelo screener nem muda a alocação por classe
- Ordem financeira inegociável: dívida de juros altos → reserva de emergência → diversificação ampla → ativos individuais
- Testes batem em APIs reais; indisponibilidade vira `skip` com motivo, contrato quebrado vira falha

---

## 2. O que eu quero construir

### 2.1 Plataforma web
- Banco **Neon** (Postgres serverless)
- Deploy na **Vercel**, com link público
- **Autenticação** completa: cadastro, login, sessão, recuperação de senha
- Perfil de usuário persistido

### 2.2 Onboarding no primeiro acesso
O usuário entra e responde o questionário de perfil. Dois caminhos:

**Já tem carteira montada** → informa os ativos por um *select* que busca na base de dados, com quantidade de cotas e preço médio de cada um.

**Ainda não tem** (meu caso — estou começando agora) → a partir das respostas, o sistema **sugere uma carteira** considerando objetivos, momento de vida, renda, mercado atual e notícias.

### 2.3 Bot de WhatsApp com custo controlado
Hoje **toda** mensagem chama o Claude, e a primeira de cada conversa custa ~US$ 0,030 (escreve ~4 mil tokens de cache). Isso não escala para vários usuários.

Quero inverter: **comandos determinísticos por padrão, LLM só quando há análise de verdade.**

- **Sem LLM** (resposta montada em código, custo zero): ver carteira, cotação, posições, peso dos ativos, perfil, ajuda, status
- **Com LLM** (só aqui): briefing semanal e análise de uma ação específica

### 2.4 Vínculo do WhatsApp no cadastro
No onboarding, depois de informar o telefone, o usuário vê um **botão que abre a conversa do bot** já com um **código de autenticação** gerado e copiado. Ele manda o código no WhatsApp; o bot confirma que o número é dele mesmo e libera os comandos.

---

## 3. A decisão de arquitetura que você precisa resolver primeiro

**Vercel é serverless e isso cria duas incompatibilidades reais com o que existe hoje.** Medi na máquina:

1. **Baileys não roda na Vercel, de jeito nenhum.** Ele mantém um WebSocket permanente com o WhatsApp e guarda a sessão pareada em disco. Função serverless não tem processo vivo nem disco persistente.

2. **A análise em Python é pesada para serverless.** `pandas` + `numpy` somam 108 MB (o limite da Vercel para funções Python é 250 MB descomprimido) e levam 1,2 s só para importar, antes de qualquer busca na rede — e uma busca de carteira no yfinance leva de 1,5 s a 36 s. Vai estourar timeout com frequência.

Avalie as opções e **recomende uma**:

| Opção | Como fica | Custo de mudança |
|---|---|---|
| **A. Topologia dividida** | Vercel (Next.js: UI, auth, sessão) + VM Oracle (API Python de análise + ponte Baileys + cron) + Neon compartilhado | Aproveita 100% do Python testado; exige CORS/autenticação entre as duas pontas e a VM vira dependência de disponibilidade |
| **B. Reescrever em TypeScript** | Tudo na Vercel, análise reimplementada em TS | Joga fora 170 testes de matemática financeira validada. Risco alto de bug sutil em RSI/alocação |
| **C. Sair da Vercel** | Tudo na VM (Next.js + Python + Baileys) | Mais simples de operar, mas perde CI/CD, preview deploys e escalabilidade da Vercel |

Minha inclinação é a **A**, mas quero seu parecer técnico — inclusive se houver uma opção D que eu não vi. Considere que a VM atual tem **1 GB de RAM** (São Paulo está sem capacidade ARM gratuita e conta free só assina uma região).

---

## 4. Perguntas que você precisa me fazer antes de codificar

Não assuma resposta para nenhuma destas — elas mudam o produto:

1. **Quem paga o LLM?** Cada briefing custa ~US$ 0,20-0,30 em créditos da minha conta Anthropic. Com N usuários isso vira uma conta real. Precisa de cota por usuário? Plano pago? Limite mensal por conta?

2. **Isso é recomendação de investimento?** Sugerir carteira para *terceiros* no Brasil entra no território da CVM (Resolução 19/2021 — consultoria de valores mobiliários exige registro). Para uso pessoal é irrelevante; como produto aberto, não é. Isso muda a linguagem do sistema inteiro ("sugestão educacional baseada em dados" vs "recomendação"), os termos de uso e possivelmente a viabilidade. **Me pergunte como quero posicionar isso.**

3. **LGPD.** Vou guardar telefone, perfil financeiro e carteira de outras pessoas. Precisa de política de privacidade, consentimento explícito e caminho de exclusão de dados.

4. **O risco do Baileys muda de natureza.** É biblioteca não oficial e contraria os termos do WhatsApp. Hoje, se o número for banido, eu perco uma ferramenta pessoal. Com usuários, perco o serviço de todos — e o número é compartilhado com outro projeto meu (StudyTrack). Vale discutir se para plataforma a Cloud API oficial passa a fazer sentido.

5. **Multiusuário num número só.** O bot atende todo mundo pelo mesmo WhatsApp; o mapa telefone → usuário é o que separa as carteiras. Qualquer erro aí vaza dado financeiro de um usuário para outro. Como você pretende garantir isso?

---

## 5. O que espero do plano

- **Modelo de dados** para o Neon: usuários, sessões, perfis, carteiras, posições, histórico de conversa, gastos de API, códigos de verificação. Inclua as decisões de índice e as restrições que impedem dado órfão.
- **Fluxo de autenticação** completo, incluindo o vínculo do WhatsApp por código (geração, expiração, uso único, tentativas).
- **Tabela de comandos do bot**, separando claramente o que é determinístico do que chama o LLM, com o formato da resposta de cada um.
- **Plano de migração**: o que do código atual é aproveitado como está, o que é adaptado e o que é descartado — e como os 170 testes sobrevivem a isso.
- **Como vamos verificar** que funciona: testes, e o que você vai rodar de verdade para provar.

Trabalhe de forma incremental: o sistema atual está **em produção e funcionando** no meu WhatsApp. Não quero um big bang que derrube o que já funciona enquanto a plataforma não estiver pronta.

---

## 6. Contexto operacional

- Python do sistema **não tem pip** — use sempre `~/dev/investai/.venv/bin/python` e `.venv/bin/pytest`
- Node 24 local; a VM tem Node 20
- VM: `ssh ubuntu@SEU_IP_DA_VM`, serviços `investai` e `investai-bridge` no systemd
- CLI da Oracle configurada em `~/.oci/config`
- Chaves já no `.env`: `ANTHROPIC_API_KEY`, `CURRENTS_API_KEY`, `BRIDGE_SECRET`, `INVESTAI_CRON_TOKEN`
- Chrome headless disponível (`google-chrome --headless=new --screenshot`) — útil para conferir UI de verdade
- Ainda **não tenho** conta no Neon nem na Vercel; vou criar quando você disser o que precisa
- Minha carteira está **vazia** — ainda não comprei nenhuma ação. Sou o primeiro usuário do caminho "não tem carteira ainda"

Leia `README.md` e `DEPLOY.md` no projeto para o resto do contexto.
