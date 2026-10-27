# Repasse — estado em 27/10/2026

Leia este arquivo e o [README das specs](README.md) antes de continuar. Depois
leia a spec da funcionalidade em que for mexer.

**O que está publicado:** código no GitHub (`main`, repo **público**), PWA na
Vercel e VM atualizada com o cron da fila rodando. O sistema está completo e
funcionando ponta a ponta.

## Em uma frase

As specs 001 a 004 estão implementadas e no ar, com a fila da VM funcionando.
O que falta são duas partes do diagnóstico da spec 002 e a reconciliação, que
depende de 60 dias de histórico.

## A VM está no ar (27/10/2026)

Deploy feito em `ubuntu@163.176.203.60` (Oracle Always Free, host
`investai-micro`). O que estava errado lá, e que nenhum teste pegaria:

1. **O `.env` da VM apontava para o Neon.** O bot rodava 13 dias contra o banco
   antigo enquanto o PWA usava o Supabase — bancos diferentes, e ninguém notou
   porque a carteira está vazia nos dois. Corrigido pelo usuário (uma linha,
   sem o valor passar por log).
2. **O crontab não tinha as linhas da fila nem do snapshot.** Só a do briefing.
   Não era "trocar `*/5` por `*`": não existiam. Instaladas, preservando a do
   briefing.
3. **As units do systemd eram as antigas.** Chamavam `server.app:app`, módulo
   que a unificação renomeou para `investai.whatsapp.app:app` — o serviço entrou
   em loop de falha assim que o código novo chegou. E o bridge vivia em
   `~/investai/bridge/`, cujo `index.js` o `rsync --delete` apagou. O estado
   (`auth_session`, `.env`, `node_modules`) foi copiado com `cp -a` para
   `apps/bridge/`, as units do repo instaladas, e `bridge/` ficou como backup —
   **não apague sem conferir**: é onde a sessão do WhatsApp estava.
   `deploy/update-vm.sh` passou a instalar as units, que era a causa raiz.

Estado conferido: ambos os serviços ativos, `/health` 200, 0 restarts, o Python
enxergando o Supabase, e um job de teste consumido pelo cron em 10 segundos.
O servidor leva ~50s para subir na micro — o health check do script dá 60s.

## Onde o sistema está publicado

- **GitHub:** `IgorCruz-dev/investai`, branch `main`. O repositório é
  **público** — varra segredos antes de qualquer push. Os `.env` reais estão
  todos no `.gitignore`; só os `.example` são versionados.
- **Vercel:** projeto `investai`, produção em `https://investai-two.vercel.app`.
  **Não está conectado ao GitHub**: push não dispara deploy. Publicar é
  `cd apps/pwa && vercel --prod`. O build está declarado em
  `apps/pwa/vercel.json` (`framework: vite`, output `dist`) de propósito — o
  painel do projeto ainda tem Root Directory `.` e o preset do `apps/web`
  antigo, e sem o `vercel.json` o deploy subiria a pasta errada.
- **Variáveis na Vercel (Production):** só `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_PUBLISHABLE_KEY`. As três do painel antigo
  (`WEB_SESSION_SECRET`, `WEB_PASSWORD_HASH`, `DATABASE_URL_POOLED`) foram
  removidas de Production e Preview, com autorização do usuário — a última era
  uma connection string parada num projeto cujas funções não existem mais.
- **Supabase:** 18 migrações aplicadas, `scripts/aplicar_supabase.py --conferir`
  aponta 0 pendências. Não use `scripts/migrar.py` (é do tempo do Neon).
- **O PWA é um PWA:** tem service worker com precache. Depois de um deploy, a
  tela do usuário pode continuar no bundle antigo até recarregar.

## Estado real do banco

| tabela | linhas | o que é |
|---|---|---|
| `perfil_investidor` | 1 | as 18 respostas do usuário e o perfil derivado |
| `planos` | 1 | plano #4, publicado pelo job #8 |
| `jobs` | 1 | job #8, `feito` |
| `movimentacoes`, `posicoes`, `ativos`, `snapshots` | 0 | ele ainda não comprou nada |

**Isto é dado real do usuário, não dado de teste.** Nenhum dado de teste ficou
no banco: o que foi criado durante a construção foi removido pelos ids exatos.
Ao exercitar o fluxo de novo, faça o mesmo — e `verificar_costura.py` /
`verificar_rls.py` já revertem a transação sozinhos.

## O caso real do usuário, e por que a carteira dele está vazia

Perfil **Moderado**, score 57,6. Alocação-alvo: renda fixa 40%, ETF 30%,
FII 25%, ação 5% (FII acima do padrão porque o objetivo declarado é renda
passiva). **Valor disponível para risco: zero** — faltam R$ 1.950 para fechar a
reserva de emergência de 6 meses, e o dinheiro vai para a reserva antes de ir
para bolsa. Com o aporte declarado de R$ 1.000/mês, a reserva fecha em ~2 meses
e a alocação passa a valer.

Então o plano #4 ter zero posições **está correto**. Não é bug, não tente
"consertar" isso.

## O que o primeiro uso real revelou

Dois defeitos que a suíte não pegava, porque nenhuma fixture representava o
estado "nada a alocar". Os dois já estão corrigidos e com teste de regressão em
`tests/test_recommender.py`:

1. **A mensagem culpava o filtro.** Com valor zero, a recomendação ia até o fim,
   saía vazia e dizia "Nenhum ativo passou pelos critérios do seu perfil. Tente
   atualizar os dados de mercado ou revise o questionário" — três inverdades, e
   um conselho que mandava o usuário mexer numa resposta correta. Hoje
   `recommend()` sai antes do filtro e da triagem nomeando o pré-requisito e o
   valor que falta, e `publish_recomendacao.py` nem busca o yfinance.
2. **A nota do aporte perdia a pontuação.** O `.replace(",", ".")` do separador
   de milhar valia para a frase inteira e comia a vírgula de "por mês,".

**Lição para a próxima leva:** o estado `investable_amount == 0` é tão comum
quanto o estado "carteira montada". Cubra os dois em qualquer fixture de perfil.

Antes disso, a execução real também pegou a soma da carteira dando R$ 24.000,02
para R$ 24.000,00 de disponível — a sobra era somada posição por posição e o
arredondamento de cada valor escapava. Virou `destinado - aplicado`, calculado
no fim. A fixture sintética não pegava porque fundamento igual em todo ativo dá
peso igual, e aí os arredondamentos se cancelam.

## A regra de custo, e a quarta porta

Só **briefing**, **análise de ativo**, **`/pergunta`** e a **triagem de notícia**
podem chamar a API da Anthropic. Todo o resto é montado em código, custo zero.

A quarta porta foi aberta de propósito pelo usuário em 27/10/2026, e é estreita:
na recomendação, o modelo só pode **vetar** um ativo por notícia grave, com o
motivo gravado — nunca pôr ativo, nem mexer em nota, peso ou cota. Ele recusou
explicitamente a opção de deixar o modelo pesar a carteira. Os limites estão na
[spec 003](003-recomendacao/spec.md) e são testados: teto de um ativo por
classe, veto que esvaziaria classe é descartado, critério fora da lista é
recusado em código (não no prompt).

`triagem_noticia.consultar_modelo` é a **única** função que gasta crédito, e é
ela que está minada com `pytest.fail` na fixture `ambiente` de
`tests/test_server.py`. **Ao acrescentar qualquer caminho pago novo, acrescente-o
à mina** — essa mina existe porque um teste já gastou crédito de verdade.
`recommend(triagem=False)` é o padrão, e só o job da VM liga.

## Como validar

```bash
.venv/bin/ruff check src scripts tests
git diff --check
.venv/bin/python -m pytest tests -q            # 532 passed, ~10 min
.venv/bin/python scripts/aplicar_supabase.py --conferir   # tem de dar 0
.venv/bin/python scripts/verificar_costura.py  # roda como postgres
.venv/bin/python scripts/verificar_rls.py      # e também como authenticated
cd apps/pwa && npm run build                   # tsc --noEmit && vite build
```

Os testes de banco são lentos porque cada query vai ao pooler remoto. O build
reclama de bundle acima de 500 kB; é só aviso.

`verificar_rls.py` cobre o que `verificar_costura.py` não pode cobrir: aquele
roda como `postgres`, que ignora RLS e tem todos os grants. `recomputar_posicoes`
**não** é `security definer`, então o gatilho reescreve `posicoes` com os grants
de quem inseriu a movimentação — um grant faltando ali quebraria "registrar
compra" sem aparecer em nenhum outro teste.

Depois de mexer nas 18 perguntas, reexporte o JSON que o PWA lê:
`.venv/bin/python scripts/exportar_perguntas.py`
(`tests/test_onboarding_export.py` quebra se esquecer).

## O que continua aberto

1. **Diagnóstico da carteira existente, spec 002 item 3c**, duas partes:
   - **qualidade** ("este ativo que você tem seria rejeitado hoje, por tal
     critério"): exige rodar `evaluate()` sobre os tickers da pessoa, que podem
     estar fora do universo curado. É job novo da VM, não cálculo de tela.
   - **convergência** (para onde mandar o próximo aporte): depende do aporte
     mensal derivado, que a aba Investimentos ainda não lê.

   Desvio por classe e concentração já existem na aba.
2. **Reconciliação** do gasto declarado contra os lançamentos (spec 002). O
   plano a deixou para depois de 60 dias de histórico; hoje não há o que
   reconciliar.
3. **Inspeção visual das telas novas** (`/onboarding`, `/carteira-sugerida`) não
   foi feita por agente: a extensão Claude in Chrome não conectou nesta sessão.
   Quem inspecionou a aba Investimentos foi o usuário.

## Sobre o arquivo solto em docs/

Existe um `docs/repasse-socio-claude-code.txt` **não versionado**, de propósito.
O usuário esclareceu o que ele é: **um documento que ele mandou ao sócio**, não
trabalho aprovado nem decisão tomada. Não há spec para isso e não há nada a
implementar.

**Não comece a construir aquilo.** Se um dia virar trabalho, começa como spec
nova (005) com as alternativas descartadas escritas — ponte Baileys única versus
duas sessões — e com a conclusão que o próprio texto já alcança: número de
WhatsApp compartilhado implica que o titular do chip pode ler as conversas do
outro, e só número próprio resolve isso. Isso é decisão dos dois sócios, nunca
do agente.

Fica fora do Git porque o repositório é público e o texto trata do arranjo de
privacidade entre duas pessoas reais. Não o versione sem pedir.

## Arquivos centrais

- **Onboarding:** `apps/pwa/src/pages/onboarding/Onboarding.tsx`,
  `CarteiraSugerida.tsx`, `apps/pwa/src/services/onboarding.ts`,
  `apps/pwa/src/data/perguntas.json` (gerado — não edite à mão).
- **Carteira:** `apps/pwa/src/pages/investimentos/Investimentos.tsx`,
  `apps/pwa/src/services/investimentos.ts`.
- **Cálculo:** `src/investai/onboarding/questionnaire.py`, `profile.py`,
  `src/investai/analysis/screener.py`, `recommender.py`, `triagem_noticia.py`.
- **VM:** `scripts/process_jobs.py`, `publish_recomendacao.py`,
  `publish_snapshot.py`, `src/investai/data/repo.py`.
- **Banco:** `supabase/migrations/` (as seis de 20261027 são a unificação).
- **Verificação:** `scripts/aplicar_supabase.py`, `verificar_costura.py`,
  `verificar_rls.py`, `exportar_perguntas.py`, `tests/conftest.py`.

## Cuidados técnicos conhecidos

- `movimentacoes` é a fonte da carteira; `posicoes` é derivada por gatilho —
  ninguém escreve em `posicoes` à mão. Compra vira despesa e venda vira receita;
  posição com `origem='onboarding'` **não** gera despesa retroativa (spec 004).
- **Aceitar um plano não cria movimentação.** A posição nasce da compra
  declarada. Se algum dia o "aceitar" criar posição, o sistema passa a afirmar
  que o usuário tem ações que ele não tem.
- O PWA **não** deriva o perfil: grava as respostas e enfileira. Duplicar as
  ~200 linhas de regra de alocação em TypeScript criaria duas fontes de verdade
  para o número que manda em tudo. O preço é a latência, e é por isso que o cron
  é de 1 minuto.
- A `.env` do usuário tem **`DATABASE_URL` duas vezes**: a primeira sobrou da
  época do Neon, sob um comentário que ainda diz "Banco (Neon Postgres)", e vale
  a última — o Session pooler do Supabase, porta 5432 (modo *session*, então o
  aviso sobre prepared statement do psycopg3 não se aplica). O arquivo é do
  usuário e não foi editado. `.env.example` está correto.
- A fixture de `tests/conftest.py` isola o schema com `SET search_path` na
  conexão; **não reverta essa correção**. A anterior usava
  `options=-csearch_path` na URL, que o pooler ignora, e testes gravaram em
  `public`.
- `verificar_costura.py` recusa o teste se `TEST3.SA` já existir, e
  `verificar_rls.py` faz o mesmo com os `TSTX*`/`TSTW*`, para não mexer no
  catálogo real.
- Remover campo de `Recommendation` quebra `tests/test_dashboard_smoke.py`: o
  painel Streamlit antigo em `src/investai/dashboard/` ainda lê o dataclass.
  Aconteceu com o campo `source`.
- A comparação de alocação da aba usa **custo**, não valor de mercado, e
  renormaliza só ações/ETFs/FIIs. `derivado.allocation` vem em pontos
  percentuais somando 100 com `renda_fixa` incluída.
- A aba Investimentos usa `window.confirm` na exclusão. Automação de navegador
  trava em diálogo modal — não clique em Excluir por lá.
- **Não recrie a conta.** O banco aceita um cadastro só e o dono é fixo; apagar
  a conta não libera a carteira para outra pessoa, e recriar não é reversível.
  Não peça nem exponha senha ou `DATABASE_URL`.
