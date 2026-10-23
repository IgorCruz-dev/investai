-- Etapa 1: tabelas financeiras do Meu Bolso.
-- Todas têm user_id → auth.users (on delete cascade) e RLS: cada usuário só vê e altera o que é seu.
-- user_id tem default auth.uid(), então o app não precisa enviar esse campo.
-- unique (id, user_id) nas tabelas "pai" permite chaves estrangeiras compostas, que impedem
-- uma transação de apontar para cartão/conta/categoria de outro usuário.

-- ===================== categorias =====================
create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  cor text not null,
  icone text not null,
  criado_em timestamptz not null default now(),
  unique (user_id, nome),
  unique (id, user_id)
);

-- ===================== contas =====================
create table public.contas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  saldo_inicial numeric(12,2) not null default 0,
  pluggy_account_id text,
  criado_em timestamptz not null default now(),
  unique (id, user_id)
);

-- ===================== cartoes =====================
create table public.cartoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  bandeira text,
  limite numeric(12,2) not null check (limite >= 0),
  dia_fechamento smallint not null check (dia_fechamento between 1 and 31),
  dia_vencimento smallint not null check (dia_vencimento between 1 and 31),
  cor text not null default '#0f172a',
  pluggy_account_id text,
  criado_em timestamptz not null default now(),
  unique (id, user_id)
);

-- ===================== transacoes =====================
create table public.transacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('receita', 'despesa')),
  forma text not null check (forma in ('debito', 'pix', 'dinheiro', 'credito')),
  conta_id uuid,
  cartao_id uuid,
  categoria_id uuid,
  descricao text not null check (length(trim(descricao)) > 0),
  local text,
  valor numeric(12,2) not null check (valor > 0),
  data date not null default current_date,
  parcela_atual smallint,
  total_parcelas smallint,
  grupo_parcela uuid,
  observacao text,
  origem text not null default 'manual' check (origem in ('manual', 'pluggy')),
  id_externo text,
  criado_em timestamptz not null default now(),

  foreign key (conta_id, user_id) references public.contas (id, user_id) on delete restrict,
  foreign key (cartao_id, user_id) references public.cartoes (id, user_id) on delete restrict,
  foreign key (categoria_id, user_id) references public.categorias (id, user_id) on delete set null (categoria_id),

  -- compra no crédito precisa dizer de qual cartão
  constraint cartao_obrigatorio_no_credito check (forma <> 'credito' or cartao_id is not null),
  -- parcelas: sem nenhuma informação, ou as duas preenchidas com 1 <= atual <= total
  constraint parcelas_validas check (
    (parcela_atual is null and total_parcelas is null)
    or (parcela_atual is not null and total_parcelas is not null and parcela_atual between 1 and total_parcelas)
  ),
  -- mesma transação importada da Pluggy não entra duas vezes
  unique (user_id, id_externo)
);

create index transacoes_user_data_idx on public.transacoes (user_id, data);
create index transacoes_user_cartao_idx on public.transacoes (user_id, cartao_id);

-- ===================== assinaturas =====================
create table public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  valor numeric(12,2) not null check (valor > 0),
  dia_cobranca smallint not null check (dia_cobranca between 1 and 31),
  categoria_id uuid,
  cartao_id uuid,
  ativa boolean not null default true,
  ultimo_lancamento date,
  criado_em timestamptz not null default now(),

  foreign key (categoria_id, user_id) references public.categorias (id, user_id) on delete set null (categoria_id),
  foreign key (cartao_id, user_id) references public.cartoes (id, user_id) on delete set null (cartao_id)
);

-- ===================== caixinha_movimentos =====================
create table public.caixinha_movimentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('deposito', 'retirada')),
  valor numeric(12,2) not null check (valor > 0),
  motivo text,
  data date not null default current_date,
  criado_em timestamptz not null default now(),

  -- retirada sempre precisa de um motivo
  constraint motivo_obrigatorio_na_retirada check (tipo <> 'retirada' or length(trim(coalesce(motivo, ''))) > 0)
);

-- ===================== RLS: só os próprios dados =====================
do $$
declare
  tabela text;
begin
  foreach tabela in array array['categorias', 'contas', 'cartoes', 'transacoes', 'assinaturas', 'caixinha_movimentos'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('create policy "Ver os próprios" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', tabela);
    execute format('create policy "Criar os próprios" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', tabela);
    execute format('create policy "Editar os próprios" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', tabela);
    execute format('create policy "Apagar os próprios" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', tabela);
  end loop;
end $$;

-- ===================== categorias padrão =====================
create function public.criar_categorias_padrao(p_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.categorias (user_id, nome, cor, icone) values
    (p_user_id, 'Comida',      '#f97316', 'comida'),
    (p_user_id, 'Eletrônicos', '#6366f1', 'eletronicos'),
    (p_user_id, 'Faculdade',   '#0ea5e9', 'faculdade'),
    (p_user_id, 'Transporte',  '#eab308', 'transporte'),
    (p_user_id, 'Saúde',       '#ef4444', 'saude'),
    (p_user_id, 'Lazer',       '#ec4899', 'lazer'),
    (p_user_id, 'Casa',        '#14b8a6', 'casa'),
    (p_user_id, 'Roupas',      '#a855f7', 'roupas'),
    (p_user_id, 'Assinaturas', '#8b5cf6', 'assinaturas'),
    (p_user_id, 'Outros',      '#64748b', 'outros')
  on conflict (user_id, nome) do nothing;
$$;

-- Só uso interno (gatilho de cadastro); ninguém chama pela API
revoke execute on function public.criar_categorias_padrao(uuid) from public, anon, authenticated;

-- Gatilho de cadastro passa a criar também as categorias padrão
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfis (id, nome, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), split_part(new.email, '@', 1)),
    new.email
  );
  perform public.criar_categorias_padrao(new.id);
  return new;
end;
$$;

-- Categorias para o(s) usuário(s) que já existem
select public.criar_categorias_padrao(id) from auth.users;
