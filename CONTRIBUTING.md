# Como contribuir

Obrigado por querer mexer no InvestAI. Este documento é curto de propósito: o
que você precisa saber para abrir um PR que entra sem discussão de estilo.

## Antes de tudo: entenda o que o projeto é

O InvestAI é uma instalação pessoal: um projeto Supabase, uma carteira e um
assistente. O PWA usa Supabase Auth; a VM usa a URI Postgres do mesmo projeto.
O primeiro cadastro é o dono das tabelas de investimento pelo RLS. O bot só
responde aos números autorizados no `.env`.

O que está fora de escopo, e PRs nessa direção vão ser recusados — não por
serem ruins, mas por mudarem o que o sistema é:

- **multiusuário**: adicionar tenants, várias carteiras ou cobrança muda o
  produto e exige nova spec;
- **promessa de retorno**: dados e recomendações são informativos, não garantia.

O porquê está nas [specs](specs/README.md) e em [docs/design.md](docs/design.md).

Também não é conselho de investimento, e nenhuma contribuição pode fingir que
é. Ver [a seção de aviso no README](README.md#aviso).

## Ambiente em 4 comandos

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dashboard,dev]"
cd apps/pwa && npm install
```

Sem `DATABASE_URL` o sistema lê `config/portfolio.json` e roda inteiro offline —
é o modo que os testes usam. Você **não** precisa de Postgres nem de WhatsApp
pareado para contribuir na maior parte do código.

## Rodando

```bash
cd apps/pwa && npm run dev             # PWA
./scripts/run-local.sh                 # servidor do WhatsApp + ponte Baileys
```

## Testes

```bash
pytest -m "not network"   # suíte offline — é o que o CI roda em todo PR
pytest                    # suíte completa, bate nas APIs reais (~12 min)
pytest -m paid            # inclui o teste que gasta créditos (desligado por padrão)
```

**Os testes usam APIs reais de propósito.** Mock de dado de mercado dá falsa
sensação de segurança: o yfinance muda de formato sem avisar, e um mock fiel à
versão de ontem passa enquanto a produção quebra. Para isso ser sustentável, a
suíte separa os dois tipos de falha, e a sua contribuição precisa manter essa
distinção:

| Situação | O teste deve |
|---|---|
| API fora, rate limit, sem internet | **pular** (`pytest.skip`) com o motivo |
| Contrato quebrado: coluna faltando, exceção escapando, tipo errado | **falhar** |

Um teste que falha quando o Wi-Fi cai é um teste que vai ser ignorado em duas
semanas.

## O que o CI exige

Todo PR roda, no GitHub Actions (Python 3.11 e 3.12):

```bash
ruff check .              # lint e ordenação de imports
pytest -m "not network"   # suíte offline
```

Rode os dois antes de abrir o PR. `ruff check --fix .` resolve a maioria.

## Convenções do código

As escolhas de construção por trás do sistema — por que Google Notícias e não
Currents, onde o modelo decide e onde não, o que o sistema deliberadamente não
faz — estão em [docs/design.md](docs/design.md). Vale ler antes de propor
mudança de arquitetura: várias dessas decisões têm medição por trás.

- **Nomes de arquivo, módulo e pasta em inglês**; docstrings, comentários,
  mensagens ao usuário e commits em **português**. O domínio é brasileiro, o
  código segue a convenção de quem lê código.
- **Nada estoura na cara do usuário.** Toda função de I/O é blindada (`@safe`) e
  devolve um valor padrão com log claro. Indicador que não pôde ser calculado
  vira `None` e aparece como **N/D** — nunca como número inventado.
- **O modelo não decide nada que o Python possa decidir.** O roteador resolve a
  intenção; o screener e o recomendador calculam os ativos e pesos. Só briefing,
  análise de ativo e perguntas abertas podem usar LLM.
- **Toda chamada de API custa dinheiro de alguém.** Se a sua mudança adiciona
  uma chamada por mensagem recebida, diga no PR quanto isso custa por mês.
- **Comentário explica o *porquê*, não o *o quê*.** Se o código precisa de
  comentário para dizer o que faz, reescreva o código.
- `line-length = 100`, mas `E501` está desligado: quebrar uma f-string de
  mensagem ao usuário no meio costuma piorar a leitura.

## Mudando o schema do banco

O schema de produção fica em `supabase/migrations`. Duas regras:

1. **Arquivo novo**, sempre: `supabase/migrations/TIMESTAMP_descricao.sql`.
   Nunca edite uma migração já aplicada; o runner registra o hash.
2. **Diga no PR** que há migração. Quem atualizar precisa rodar
   `python scripts/aplicar_supabase.py`.

```bash
python scripts/aplicar_supabase.py --conferir
python scripts/aplicar_supabase.py
```

## Commits e PRs

Mensagem de commit no imperativo, dizendo o efeito, não o arquivo:

```
Conta a escrita de cache no custo e responde saudação localmente     ✅
Atualiza llm_analyst.py                                              ❌
```

No PR, descreva **o que muda para quem usa** e como você verificou. Se tocou em
custo de API, no schema do banco ou no deploy, diga isso em destaque.

## Segurança e privacidade

Este repositório é público, e o sistema lida com carteira de investimento de
pessoas reais. Antes de todo commit:

- Nunca versione `.env`, `apps/bridge/.env`, `apps/bridge/auth_session/`,
  `config/portfolio.json` ou `config/profile.json` — o
  `.gitignore` já cobre todos, não force.
- Nada de IP de servidor, número de telefone, connection string ou posição real
  de carteira em código, teste, exemplo ou documentação. Use placeholders
  (`SEU_IP_DA_VM`, `SEU_NUMERO_PESSOAL`) e os tickers de exemplo.
- Achou uma vulnerabilidade? Abra uma
  [security advisory](https://github.com/IgorCruz-dev/investai/security/advisories/new)
  em vez de uma issue pública.

## Convivência

Crítica é sobre o código, nunca sobre a pessoa. Discordância técnica se resolve
com dado, teste ou medição — quem traz o número ganha a discussão.
