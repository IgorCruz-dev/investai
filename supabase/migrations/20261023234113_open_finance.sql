-- Etapa 9: Open Finance via Meu Pluggy (somente leitura).
-- A Edge Function sync-pluggy roda com o login de quem chama, então o RLS vale também para ela.

-- 1) Categoria da Pluggy (texto em inglês, ex.: "Groceries") → categoria do app
create table public.mapeamento_categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  categoria_pluggy text not null check (length(trim(categoria_pluggy)) > 0),
  categoria_id uuid not null,
  criado_em timestamptz not null default now(),
  unique (user_id, categoria_pluggy),
  foreign key (categoria_id, user_id) references public.categorias (id, user_id) on delete cascade
);

-- 2) Regra por local: "toda transação importada de UBER vai para Transporte".
--    Vale antes do mapeamento por categoria. local fica minúsculo e sem espaços nas pontas.
create table public.regras_categoria_local (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local text not null check (local = lower(trim(local)) and length(local) > 0),
  categoria_id uuid not null,
  criado_em timestamptz not null default now(),
  unique (user_id, local),
  foreign key (categoria_id, user_id) references public.categorias (id, user_id) on delete cascade
);

-- 3) Resultado de cada sincronização
create table public.sync_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data timestamptz not null default now(),
  status text not null check (status in ('sucesso', 'parcial', 'erro')),
  mensagem text,
  importadas integer not null default 0,
  atualizadas integer not null default 0
);
create index sync_log_user_data_idx on public.sync_log (user_id, data desc);

-- 4) Conexões (items) da Pluggy: status e vencimento do consentimento, para os avisos do app
create table public.pluggy_conexoes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id text not null,
  banco text not null,
  status text not null,
  erro text,
  consentimento_expira_em timestamptz,
  atualizado_no_banco_em timestamptz,
  verificado_em timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- 5) Contas e cartões que a Pluggy enxerga, para a tela de vínculo
create table public.pluggy_contas (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  item_id text not null,
  tipo text not null check (tipo in ('BANK', 'CREDIT')),
  nome text not null,
  numero text,
  banco text,
  saldo numeric(14,2),
  limite numeric(14,2),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, id)
);

-- 6) Importadas que o usuário excluiu: a sincronização não traz de novo
create table public.transacoes_ignoradas (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_externo text not null,
  excluida_em timestamptz not null default now(),
  primary key (user_id, id_externo)
);

-- RLS: só os próprios dados
do $$
declare
  tabela text;
begin
  foreach tabela in array array['mapeamento_categorias', 'regras_categoria_local', 'sync_log', 'pluggy_conexoes', 'pluggy_contas', 'transacoes_ignoradas'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('create policy "Ver os próprios" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', tabela);
    execute format('create policy "Criar os próprios" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', tabela);
    execute format('create policy "Editar os próprios" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', tabela);
    execute format('create policy "Apagar os próprios" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', tabela);
  end loop;
end $$;

-- Uma conta/cartão da Pluggy vincula com no máximo uma conta e um cartão do app
create unique index contas_pluggy_unico on public.contas (user_id, pluggy_account_id) where pluggy_account_id is not null;
create unique index cartoes_pluggy_unico on public.cartoes (user_id, pluggy_account_id) where pluggy_account_id is not null;

-- Excluir uma importada guarda o id_externo. security definer porque precisa ler auth.users;
-- só grava o user_id da própria linha excluída (que o RLS já deixou o usuário excluir).
-- O exists evita erro quando a exclusão vem em cascata da remoção do próprio usuário.
create function public.lembrar_transacao_excluida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.origem = 'pluggy' and old.id_externo is not null
     and exists (select 1 from auth.users where id = old.user_id) then
    insert into public.transacoes_ignoradas (user_id, id_externo)
    values (old.user_id, old.id_externo)
    on conflict do nothing;
  end if;
  return old;
end;
$$;

revoke execute on function public.lembrar_transacao_excluida() from public, anon, authenticated;

create trigger lembrar_transacao_excluida
  after delete on public.transacoes
  for each row execute function public.lembrar_transacao_excluida();
