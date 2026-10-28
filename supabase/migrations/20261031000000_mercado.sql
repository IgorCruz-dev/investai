-- Dados de mercado (públicos, iguais para todo mundo): séries do Banco Central e expectativas do Focus.
-- Quem grava é a função mercado-sync (service role); o app só lê.
create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;

-- selic_meta, cdi_anual, ipca_mes, ipca_12m, dolar (% ao ano, % no mês ou R$)
create table public.indicadores (
  serie text not null,
  dia date not null,
  valor numeric not null,
  gravado_em timestamptz not null default now(),
  primary key (serie, dia)
);

-- Mediana do Focus para o fim de cada ano (Selic, IPCA, Câmbio), por data de coleta
create table public.expectativas (
  indicador text not null,
  ano int not null,
  data_coleta date not null,
  mediana numeric not null,
  primary key (indicador, ano, data_coleta)
);

alter table public.indicadores enable row level security;
alter table public.expectativas enable row level security;

create policy "indicadores: leitura para quem está logado" on public.indicadores
  for select to authenticated using (true);
create policy "expectativas: leitura para quem está logado" on public.expectativas
  for select to authenticated using (true);

-- Último dia e última gravação de cada série: a função busca só o que falta e não repete em menos de 30 min
create function public.ultimos_dias_indicadores()
returns table (serie text, dia date, gravado_em timestamptz)
language sql stable set search_path = '' as $$
  select i.serie, max(i.dia), max(i.gravado_em) from public.indicadores i group by i.serie
$$;
