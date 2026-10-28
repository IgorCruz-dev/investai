-- Carteira: posições que vêm da Pluggy (Open Finance) ou cadastradas à mão, e o saldo de cada dia para a evolução.
-- empresarial: a posição é de uma conexão/conta da empresa (fica fora do patrimônio pessoal)
create table public.investimentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  origem text not null default 'manual' check (origem in ('pluggy', 'manual')),
  id_externo text,
  instituicao text,
  -- FIXED_INCOME, SECURITY, MUTUAL_FUND, EQUITY, ETF, COE (tipos da Pluggy) ou CASH (dólar em espécie, cripto...)
  tipo text not null,
  subtipo text,
  nome text not null,
  -- Ticker (PETR4, HGLG11) ou código do papel
  codigo text,
  emissor text,
  -- CDI, SELIC, IPCA, PRE...
  indexador text,
  -- % do indexador (ex.: 100 = 100% do CDI) ou taxa ao ano, como a Pluggy manda
  taxa numeric,
  taxa_anual_fixa numeric,
  vencimento date,
  quantidade numeric,
  valor_aplicado numeric,
  saldo_bruto numeric not null default 0,
  saldo_liquido numeric,
  empresarial boolean not null default false,
  status text not null default 'ACTIVE',
  observacao text,
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  unique (user_id, id_externo)
);

create table public.investimentos_historico (
  investimento_id uuid not null references public.investimentos (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dia date not null,
  saldo_bruto numeric not null,
  saldo_liquido numeric,
  primary key (investimento_id, dia)
);

-- Cotação dos tickers da carteira (brapi), igual para todo mundo; grava a função mercado-sync
create table public.cotacoes (
  ticker text primary key,
  nome text,
  preco numeric not null,
  variacao_dia numeric,
  cotado_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.investimentos enable row level security;
alter table public.investimentos_historico enable row level security;
alter table public.cotacoes enable row level security;

create policy "investimentos: dono" on public.investimentos
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "investimentos_historico: dono" on public.investimentos_historico
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "cotacoes: leitura para quem está logado" on public.cotacoes
  for select to authenticated using (true);

create index investimentos_historico_user_dia on public.investimentos_historico (user_id, dia);
