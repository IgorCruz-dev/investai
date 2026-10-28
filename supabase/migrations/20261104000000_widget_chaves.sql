-- Chaves do widget (Scriptable no iPhone): cada uma só lê o resumo da Edge Function widget. Guarda o hash SHA-256, nunca
-- a chave. Sem policies: só a service role (a Edge Function) lê.
create table public.widget_chaves (
  chave_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  nome text not null default 'Scriptable',
  criada_em timestamptz not null default now(),
  usada_em timestamptz
);

create index widget_chaves_user on public.widget_chaves (user_id);

alter table public.widget_chaves enable row level security;
