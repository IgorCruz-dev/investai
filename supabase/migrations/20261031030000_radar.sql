-- Radar de oportunidades (fase 4): gasto da IA, sinais do dia e diário de teses.

-- Gasto da IA por mês (todas as chamadas do app somadas); quem grava é a service role, via registrar_uso_ia
create table public.ia_uso (
  mes date primary key,
  chamadas integer not null default 0,
  tokens_entrada bigint not null default 0,
  tokens_saida bigint not null default 0,
  custo_usd numeric(12, 6) not null default 0,
  -- Teto em vigor (secret IA_LIMITE_MENSAL_USD), gravado a cada chamada para o app mostrar "US$ X de US$ Y"
  limite_usd numeric(8, 2),
  atualizado_em timestamptz not null default now()
);

alter table public.ia_uso enable row level security;
create policy "ia_uso: leitura para quem está logado" on public.ia_uso
  for select to authenticated using (true);

-- Soma atômica: duas funções chamando ao mesmo tempo não perdem gasto
create or replace function public.registrar_uso_ia(p_entrada bigint, p_saida bigint, p_custo numeric, p_limite numeric)
returns numeric
language sql
security definer
set search_path = public
as $$
  insert into public.ia_uso as u (mes, chamadas, tokens_entrada, tokens_saida, custo_usd, limite_usd)
  values (date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, 1, p_entrada, p_saida, p_custo, p_limite)
  on conflict (mes) do update set
    chamadas = u.chamadas + 1,
    tokens_entrada = u.tokens_entrada + excluded.tokens_entrada,
    tokens_saida = u.tokens_saida + excluded.tokens_saida,
    custo_usd = u.custo_usd + excluded.custo_usd,
    limite_usd = excluded.limite_usd,
    atualizado_em = now()
  returning custo_usd;
$$;

revoke execute on function public.registrar_uso_ia(bigint, bigint, numeric, numeric) from public, anon, authenticated;

-- Sinais do dia, iguais para todo mundo. As regras pessoais (reserva, teto de 10%) são aplicadas no app
create table public.sinais (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  -- quant: regra numérica sem IA; ia: tese gerada a partir das notícias + números
  origem text not null check (origem in ('quant', 'ia')),
  -- pos_fixado | prefixado | ipca | cambio | acoes | outro
  classe text not null,
  ativo text,
  direcao text check (direcao in ('alta', 'baixa', 'neutra')),
  titulo text not null,
  tese text not null,
  embutido text,
  confirma text,
  invalida text,
  risco text,
  prazo_dias integer,
  pct_max numeric,
  -- Quanto cai (em %) se der o cenário contrário
  perda_contraria_pct numeric,
  relevancia numeric,
  noticias text[] not null default '{}',
  criado_em timestamptz not null default now()
);

create index sinais_dia on public.sinais (dia desc);

alter table public.sinais enable row level security;
create policy "sinais: leitura para quem está logado" on public.sinais
  for select to authenticated using (true);

-- Diário de teses: o que o usuário fez com cada sinal, para medir a taxa de acerto
create table public.teses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sinal_id uuid references public.sinais (id) on delete set null,
  titulo text not null,
  ativo text,
  direcao text check (direcao in ('alta', 'baixa', 'neutra')),
  decisao text not null check (decisao in ('entrei', 'passei')),
  valor numeric(14, 2),
  preco_entrada numeric,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  prazo_dias integer,
  preco_final numeric,
  resultado text check (resultado in ('acertou', 'errou')),
  fechada_em date,
  criada_em timestamptz not null default now()
);

create index teses_user on public.teses (user_id, dia desc);

alter table public.teses enable row level security;
create policy "teses: dono lê" on public.teses for select to authenticated using (user_id = (select auth.uid()));
create policy "teses: dono cria" on public.teses for insert to authenticated with check (user_id = (select auth.uid()));
create policy "teses: dono altera" on public.teses for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "teses: dono apaga" on public.teses for delete to authenticated using (user_id = (select auth.uid()));

-- Para que serve seguir o sinal (proteger, ganhar com a queda, render mais com segurança...)
alter table public.sinais add column objetivo text;
