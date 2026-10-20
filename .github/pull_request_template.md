## O que muda

<!-- Para quem USA o sistema, não para quem lê o diff. -->

## Por quê

## Como verifiquei

- [ ] `ruff check .` limpo
- [ ] `pytest -m "not network"` passando
- [ ] `pytest` (suíte completa, APIs reais) passando — ou digo abaixo o que pulou e por quê

## Impacto

- [ ] Muda o **custo** de alguma rota (quanto, por mês?)
- [ ] Muda o **schema do banco** (migração incluída em `deploy/sql/`?)
- [ ] Muda o **deploy** (systemd, cron, Vercel, variável de ambiente nova?)
- [ ] Nada disso
