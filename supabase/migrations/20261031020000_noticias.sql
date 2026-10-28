-- Notícias que mexem com investimentos (Google News RSS), iguais para todo mundo; grava a função noticias-sync.
-- id: hash do título normalizado (a mesma matéria vem com links diferentes em buscas diferentes)
create table public.noticias (
  id text primary key,
  titulo text not null,
  fonte text,
  link text not null,
  publicada_em timestamptz not null,
  temas text[] not null default '{}',
  tickers text[] not null default '{}',
  -- Preenchido pela IA na fase 4: direção, ativos afetados, prazo, resumo
  classificacao jsonb,
  relevancia numeric,
  criada_em timestamptz not null default now()
);

create index noticias_publicada_em on public.noticias (publicada_em desc);

alter table public.noticias enable row level security;
create policy "noticias: leitura para quem está logado" on public.noticias
  for select to authenticated using (true);
