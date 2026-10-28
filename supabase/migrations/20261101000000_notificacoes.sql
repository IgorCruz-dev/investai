-- Notificações push (Web Push / VAPID): inscrição de cada aparelho, tipos desligados e histórico do que foi enviado.
-- Quem envia é a Edge Function notificar (service role), chamada pelo pg_cron de hora em hora.

-- Um aparelho/navegador inscrito. O endpoint é único: inscrever de novo no mesmo aparelho só atualiza as chaves.
create table public.push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  dispositivo text,
  criado_em timestamptz not null default now()
);

create index push_inscricoes_user on public.push_inscricoes (user_id);

alter table public.push_inscricoes enable row level security;
create policy "push_inscricoes: dono lê" on public.push_inscricoes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "push_inscricoes: dono cria" on public.push_inscricoes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "push_inscricoes: dono altera" on public.push_inscricoes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "push_inscricoes: dono apaga" on public.push_inscricoes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Tudo vem ligado; aqui ficam só os tipos que a pessoa desligou
create table public.notificacoes_preferencias (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  desligadas text[] not null default '{}',
  atualizado_em timestamptz not null default now()
);

alter table public.notificacoes_preferencias enable row level security;
create policy "notificacoes_preferencias: dono lê" on public.notificacoes_preferencias for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notificacoes_preferencias: dono cria" on public.notificacoes_preferencias for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "notificacoes_preferencias: dono altera" on public.notificacoes_preferencias for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Histórico. A chave identifica o evento (ex.: fatura:<cartão>:<mês>:d3) e impede enviar o mesmo aviso duas vezes.
create table public.notificacoes_enviadas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  chave text not null,
  tipo text not null,
  titulo text not null,
  corpo text not null,
  url text,
  enviada_em timestamptz not null default now(),
  unique (user_id, chave)
);

create index notificacoes_enviadas_user on public.notificacoes_enviadas (user_id, enviada_em desc);

alter table public.notificacoes_enviadas enable row level security;
create policy "notificacoes_enviadas: dono lê" on public.notificacoes_enviadas for select to authenticated
  using (user_id = (select auth.uid()));
