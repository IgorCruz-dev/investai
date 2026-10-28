-- Receitas previstas: o que costuma entrar todo mês (salário, vale-alimentação...).
-- Enquanto não chega, entra no resultado do mês como previsto; quando a receita de verdade aparece, a prevista sai.
create table public.receitas_previstas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  valor numeric(12,2) not null check (valor > 0),
  dia smallint not null check (dia between 1 and 31),
  criado_em timestamptz not null default now()
);

create index receitas_previstas_user_id_idx on public.receitas_previstas (user_id);

alter table public.receitas_previstas enable row level security;
create policy "Ver os próprios" on public.receitas_previstas for select to authenticated using ((select auth.uid()) = user_id);
create policy "Criar os próprios" on public.receitas_previstas for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Editar os próprios" on public.receitas_previstas for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Apagar os próprios" on public.receitas_previstas for delete to authenticated using ((select auth.uid()) = user_id);
