# Repasse de sessão — 27/10/2026 (segunda sessão)

Leia este arquivo, `spec.md`, `plan.md` e `tasks.md` antes de continuar.
**Não recomece a migração nem recrie a conta.** A primeira conta pessoal já foi
criada pelo usuário no projeto Supabase novo. Não peça nem exponha senha ou
`DATABASE_URL`.

## Onde está o projeto

- Raiz: `/home/igor/dev/investai`.
- `apps/pwa`: interface financeira Money incorporada por subtree e reestilizada
  para InvestAI. O histórico do Money tem 71 commits; o InvestAI antigo tinha 16.
- `supabase/migrations`: 12 migrações Money e 5 novas de investimento, costura,
  proteção de lançamento, cadastro único e dono estável. Todas as **17** estão
  aplicadas; `scripts/aplicar_supabase.py --conferir` aponta **0 pendências**.
  Não use `scripts/migrar.py` no Supabase.
- `apps/web` e o registro multiusuário foram removidos. A VM Python, o PWA e o
  bot consultam o mesmo banco; a VM ainda precisa de deploy próprio.
- O PWA roda em `http://localhost:5173/`. Se parou, `npm run dev` em `apps/pwa`.
- Há muitas alterações **sem commit** no working tree, incluindo trabalho de
  duas sessões anteriores. Não use `git reset`, `clean` ou checkout destrutivo.
  Nada desta leva foi enviado ao remoto, e o deploy segue não autorizado.

## O que está comprovado

- A `DATABASE_URL` da `.env` conecta ao Supabase novo. As credenciais não devem
  aparecer em logs, prints, comentários ou resposta ao usuário.
- A conta real existe: 1 usuário Auth, 1 linha em `instalacao`, 1 perfil Money,
  11 categorias, e o dono da instalação corresponde ao usuário Auth.
- `scripts/verificar_costura.py` passa: segunda conta recusada, dono protegido
  contra exclusão, compra → despesa/posição, edição, exclusão, proteção contra
  editar o lançamento diretamente e onboarding sem despesa retroativa.
- `scripts/verificar_rls.py` passa, e agora cobre **dois** caminhos distintos:
  1. isolamento — dono autenticado lê e escreve; outra identidade autenticada e
     visitante não veem os investimentos; cadastro fechado para visitante;
  2. **o caminho de escrita da aba**, como `authenticated`: inserir ativo,
     registrar compra (posição e despesa de R$ 31,00 conferidas), recusar venda
     acima da posição, editar e excluir a movimentação.
  O item 2 foi acrescentado nesta sessão porque `verificar_costura.py` roda como
  `postgres`, que ignora RLS e tem todos os grants — ele nunca provaria que a
  aba funciona. `recomputar_posicoes` **não** é `security definer`: o gatilho
  apaga e reescreve `posicoes` com os grants de quem inseriu a movimentação.
  Um grant faltando ali quebraria "registrar compra" sem aparecer em nenhum
  outro teste. Hoje os grants estão corretos.
- O teste do item 2 também fixa a frase `excede a posição`, que
  `services/investimentos.ts` casa por substring para explicar a recusa ao
  usuário. Se a mensagem da migração mudar, o teste cai antes da interface.
- A fila `jobs` processou um pedido `snapshot` e criou um snapshot vazio válido.
  Dois jobs e um snapshot de teste foram removidos com IDs exatos; nenhum dado
  de teste ficou no banco. O PWA consulta novamente enquanto o job está em
  andamento e informa falha da última tentativa.
- Validação final desta sessão, toda verde: `ruff check src scripts tests`,
  `git diff --check`, `npm run build` em `apps/pwa` (o script é
  `tsc --noEmit && vite build`, então o type-check passou),
  `scripts/aplicar_supabase.py --conferir` com 0 pendências, os dois
  verificadores de banco, e `.venv/bin/python -m pytest tests -q` →
  **530 passed em 9m46s** (inclui os testes de banco; são lentos porque cada
  query vai ao pooler remoto). Sobra só o aviso de bundle acima de 500 kB.
  As sete tabelas estão em 0 linhas: nenhum dado de teste ficou.
  Um detalhe que custou uma rodada: remover o campo `source` de
  `Recommendation` quebrou `test_dashboard_smoke.py`, porque o painel Streamlit
  antigo ainda o lia. Se mexer no dataclass, confira `src/investai/dashboard/`.
- A fixture de `tests/conftest.py` isola o schema nos testes Supabase com
  `SET search_path` na conexão; **não reverta essa correção**.
- Login e cadastro foram inspecionados em Chrome headless, celular e desktop.

## O que mudou no código nesta sessão

- `apps/pwa/src/services/investimentos.ts`: a consulta de `jobs` agora filtra
  `tipo = 'snapshot'`. Antes ela pegava o job mais recente de **qualquer** tipo,
  então um `briefing` ou `validar_tickers` pendente faria a aba anunciar
  "Atualização em andamento", desabilitar o botão *Atualizar dados* e, no caso
  de erro, dizer que a atualização falhou — tudo por causa de um job que não era
  o dela. `pedirAtualizacao()` já filtrava por `snapshot`; as duas pontas agora
  concordam. O defeito estava latente porque `repo.enfileirar_job()` ainda não
  tem chamador: hoje só o PWA (sempre `snapshot`) insere na fila. Deixa de ser
  latente no momento em que o botão de briefing existir.
- `scripts/verificar_rls.py`: o bloco do caminho de escrita descrito acima.

## A spec 001 está concluída

O usuário inspecionou a aba `/investimentos` autenticada em 27/10/2026 e
aprovou ("ficou muito bom"). Era o último item aberto; a extensão Claude in
Chrome nunca conectou nesta sessão, então quem inspecionou foi ele.

Antes de commit ou deploy, conferir o diff e não incluir `.env`, `.env.local`
nem dados pessoais. **O usuário ainda não autorizou publicação nem deploy, e
nada desta leva foi commitado.**

## As specs 002, 003 e 004 também estão implementadas

Na inspeção da aba o usuário apontou o que faltava de produto: ele não tem
carteira, e a aba não oferecia responder as 18 perguntas nem receber uma carteira
sugerida. Isso foi construído na sequência. O que existe hoje:

- **Onboarding no PWA** (`pages/onboarding/Onboarding.tsx`): as 18 perguntas uma
  por vez, com rascunho em `localStorage`, a bifurcação "já tem carteira?" e a
  importação por `ticker quantidade`.
- **Carteira sugerida** (`pages/onboarding/CarteiraSugerida.tsx`): pré-requisitos
  no topo, posições com a justificativa de cada peso, vetos de notícia com a
  frase e a fonte, rejeitados com o critério, e o aceite que **não** compra nada.
- **Job `recomendacao`** (`scripts/publish_recomendacao.py`): o PWA grava as
  respostas e enfileira; a VM deriva o perfil, roda o filtro e publica o plano.
  O cron da fila passou de 5 minutos para **1 minuto** por causa disso.
- **Veto por notícia** (`src/investai/analysis/triagem_noticia.py`): a quarta
  porta paga do produto, aberta de propósito. Decisão do usuário em 27/10/2026,
  entre três opções apresentadas; ele recusou deixar o modelo pesar a carteira.

### O que ficou de fora, e por quê

- **Qualidade e convergência do diagnóstico 3c** (spec 002). Qualidade exige
  rodar `evaluate()` sobre os tickers da pessoa, que podem estar fora do universo
  curado — é um job novo da VM, não um cálculo de tela. Convergência depende do
  aporte mensal derivado, que a aba ainda não lê. Desvio por classe e
  concentração estão prontos.
- **Reconciliação do gasto declarado** (spec 002). O próprio plano a deixou para
  depois de 60 dias de lançamento: hoje não há histórico para reconciliar.

### O que a execução real revelou

Rodar o job contra o mercado de verdade pegou um defeito que a suíte não pegava:
a carteira somou **R$ 24.000,02** para R$ 24.000,00 de disponível, violando a
promessa da spec 003 de fechar no centavo. A sobra era somada posição por
posição, e o arredondamento de cada `amount` escapava. Virou
`destinado - aplicado` no fim, e há teste de regressão com nota e preço
irregulares — a fixture antiga não pegava porque fundamento igual em todo ativo
dá peso igual, e aí os arredondamentos se cancelam.

**Nenhum dado de teste ficou no banco.** O fluxo foi exercitado de verdade (dois
planos publicados, perfil semeado) e removido pelos ids exatos; as sete tabelas
voltaram a 0 linhas. A triagem foi exercitada com o modelo simulado, para provar
a fiação sem gastar crédito: 13 aprovados enviados, veto aplicado, critério
inventado descartado em código, soma ainda fechando.

## Arquivos centrais

- PWA: `apps/pwa/src/pages/investimentos/Investimentos.tsx`,
  `apps/pwa/src/services/investimentos.ts`, `apps/pwa/src/App.tsx`,
  `apps/pwa/src/components/BottomNav.tsx`, `apps/pwa/src/types/database.ts`.
- Costura: `supabase/migrations/20261027010000_investimentos.sql` até
  `20261027050000_dono_estavel.sql`.
- VM: `scripts/process_jobs.py`, `scripts/publish_snapshot.py`,
  `src/investai/data/repo.py`, `src/investai/snapshot.py`.
- Verificação: `scripts/aplicar_supabase.py`, `scripts/verificar_costura.py`,
  `scripts/verificar_rls.py`, `tests/conftest.py`, `tests/test_migrations.py`.
- Operação: `README.md`, `docs/deploy.md`, `.env.example`.

## Cuidados técnicos conhecidos

- `movimentacoes` é a fonte da carteira; `posicoes` é derivada por trigger.
  Uma compra/venda cria o lançamento financeiro correspondente; onboarding
  não cria despesa retroativa. A sobra do arredondamento da recomendação vai
  para liquidez, mas uma classe sem candidato aprovado não é realocada.
- A `.env` do usuário tem **`DATABASE_URL` duas vezes**: a primeira sobrou da
  época do Neon, sob o comentário "Banco (Neon Postgres)", e a segunda — a que
  vale, porque o dotenv fica com a última — é o Session pooler do Supabase.
  Sem porta explícita, resolve para 5432, que é *session* mode; o aviso do
  comentário sobre o pooler em modo transação derrubar prepared statement do
  psycopg3 não se aplica a essa URL. O arquivo é do usuário e não foi editado:
  vale limpar a entrada morta e o comentário desatualizado, que hoje dizem que
  o banco é Neon. `.env.example` já está correto e com uma única entrada.
- A fixture antiga usava `options=-csearch_path` na URL, ignorado pelo pooler,
  e testes chegaram a gravar em `public`. Corrigido com `SET search_path` na
  conexão e schema explícito nas migrações; os dados espúrios foram removidos.
  Confira isolamento ao alterar testes do banco.
- O validador de costura funciona antes e depois do primeiro cadastro, e recusa
  o teste se `TEST3.SA` já existir, para não mexer no catálogo real.
  `verificar_rls.py` faz o mesmo com os tickers `TSTX*`/`TSTW*` que cria.
- A comparação de alocação da aba usa **custo**, não valor de mercado, e
  renormaliza só ações/ETFs/FIIs: `derivado.allocation` vem em pontos
  percentuais somando 100 com `renda_fixa` incluída, e o card diz isso em
  texto. Um perfil 100% renda fixa esconde o card em vez de dividir por zero.
- Detalhe marginal não mexido: uma venda `web` cujas taxas consomem o valor
  todo não gera lançamento (o gatilho se recusa a inventar valor ≤ 0), mas o
  `window.confirm` da exclusão promete apagar "o lançamento correspondente".
- A atualização de mercado da aba é assíncrona via `jobs` e cron da VM. O
  snapshot vazio de teste provou a ponte; cotações reais ainda dependem de
  posições e rede da VM.
