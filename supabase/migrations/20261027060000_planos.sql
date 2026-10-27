-- Planos: a carteira sugerida, salva como lista de conferência.
--
-- A regra que esta tabela existe para proteger está no item 4 da spec 002:
-- **recomendação aceita não cria movimentação.** Aceitar uma carteira sugerida
-- não compra nada — a compra acontece na corretora, e pode acontecer por outro
-- preço, parcialmente, ou nunca. Se o "aceitar" criasse posição, o sistema
-- passaria a afirmar que a pessoa tem ações que ela não tem, e todo número
-- derivado dali (patrimônio, alocação, resultado) seria ficção.
--
-- Então o plano fica aqui, separado de `movimentacoes`, e a posição só nasce
-- quando a compra é declarada pelo caminho normal de escrita.

-- ===================== a fila ganha o pedido de recomendação =====================
-- O PWA não tem pandas, nem yfinance, nem as regras de perfil: ele grava as 18
-- respostas e enfileira. A VM deriva o perfil, roda o screener, monta a carteira
-- e grava o plano. Mesmo desenho do `snapshot`, outro tipo.
alter table public.jobs drop constraint jobs_tipo_check;
alter table public.jobs add constraint jobs_tipo_check
  check (tipo in ('briefing', 'snapshot', 'validar_tickers', 'recomendacao'));

-- ===================== planos =====================
create table public.planos (
  id         bigserial primary key,
  gerado_em  timestamptz not null default now(),
  -- Posições, rejeitados, vetos de notícia e as marcas de carteira incompleta
  -- ou sem triagem. JSON pronto: o PWA só lê e desenha.
  payload    jsonb not null,
  -- Quando a pessoa marcou o plano como aceito. Aceitar não compra nada; é só
  -- o registro de que ela decidiu seguir esta lista.
  aceito_em  timestamptz
);

create index planos_recente_idx on public.planos (gerado_em desc);

comment on table public.planos is
  'Carteira sugerida (specs 002 e 003). Lista de conferência, nunca posição: '
  'aceitar um plano não cria movimentação.';

-- ===================== RLS =====================
-- Mesma política das tabelas de investimento: o dono da instalação, conferido
-- pela sessão do PWA. A VM conecta como `postgres` e não passa por aqui.
alter table public.planos enable row level security;
create policy "Dono do sistema" on public.planos
  for all to authenticated
  using ((select auth.uid()) = (select public.meu_usuario()))
  with check ((select auth.uid()) = (select public.meu_usuario()));
