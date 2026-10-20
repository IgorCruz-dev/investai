# Como contribuir

Obrigado por querer mexer no InvestAI. Este documento é curto de propósito: o
que você precisa saber para abrir um PR que entra sem discussão de estilo.

## Antes de tudo: entenda o que o projeto é

O InvestAI é **uma carteira por pessoa, um banco por pessoa**. Dá para
compartilhar uma instância com um grupo pequeno — o bot diferencia pelo
telefone, o painel pelo login — mas cada pessoa continua tendo o seu Postgres e
a sua chave da Anthropic. O isolamento é a **conexão**, não um `where usuario =`:
o schema é de uma carteira por banco (`posicoes` com `ticker` como chave
primária, `perfil` com `check (id = 1)`), e é assim que fica.

O que está fora de escopo, e PRs nessa direção vão ser recusados — não por
serem ruins, mas por mudarem o que o sistema é:

- **cadastro aberto**: criar conta pela tela, cobrança, convite por e-mail.
  Quem entra, entra porque alguém pôs as credenciais dessa pessoa no registro;
- **carteira de várias pessoas no mesmo banco**, via coluna `usuario` e
  `where`. Um `where` esquecido em uma das ~20 funções do `repo.py` vaza
  carteira entre pessoas; a separação por banco não tem essa classe de bug;
- **chave de API compartilhada**: cada pessoa traz a sua. Sem isso o uso de uma
  sai do crédito de quem hospeda, e o gasto de uma bloqueia a IA das outras.

O porquê de cada uma dessas decisões está em
[docs/design.md](docs/design.md#várias-pessoas-um-banco-para-cada).

Também não é conselho de investimento, e nenhuma contribuição pode fingir que
é. Ver [a seção de aviso no README](README.md#aviso).

## Ambiente em 4 comandos

```bash
git clone https://github.com/IgorCruz-dev/investai.git
cd investai
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dashboard,dev]"      # pacote + Streamlit + pytest + ruff
cp .env.example .env                   # preencha ANTHROPIC_API_KEY
```

Sem `DATABASE_URL` o sistema lê `config/portfolio.json` e roda inteiro offline —
é o modo que os testes usam. Você **não** precisa de Postgres nem de WhatsApp
pareado para contribuir na maior parte do código.

## Rodando

```bash
streamlit run main.py                  # dashboard local em localhost:8501
./scripts/run-local.sh                 # servidor do WhatsApp + ponte Baileys
```

## Testes

```bash
pytest -m "not network"   # 414 testes offline — é o que o CI roda em todo PR
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
  intenção antes de qualquer chamada de API; o screener decide quais ativos
  podem entrar; o LLM só distribui pesos e explica. Nenhuma ferramenta de
  escrita é exposta ao modelo.
- **Toda chamada de API custa dinheiro de alguém.** Se a sua mudança adiciona
  uma chamada por mensagem recebida, diga no PR quanto isso custa por mês.
- **Comentário explica o *porquê*, não o *o quê*.** Se o código precisa de
  comentário para dizer o que faz, reescreva o código.
- `line-length = 100`, mas `E501` está desligado: quebrar uma f-string de
  mensagem ao usuário no meio costuma piorar a leitura.

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
  `config/portfolio.json`, `config/profile.json` ou `apps/web/data.js` — o
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
