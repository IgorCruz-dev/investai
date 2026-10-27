-- Perfis dos usuários.
-- O login (e-mail e senha) fica na tabela interna auth.users do Supabase;
-- aqui ficam os dados do app ligados a cada conta, como o nome.

create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text not null,
  criado_em timestamptz not null default now()
);

comment on table public.perfis is 'Dados de cada usuário do app (1 linha por conta em auth.users).';

-- RLS: cada pessoa só enxerga e edita o próprio perfil
alter table public.perfis enable row level security;

create policy "Usuário vê o próprio perfil"
  on public.perfis for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Usuário edita o próprio perfil"
  on public.perfis for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Cria o perfil automaticamente quando alguém se cadastra.
-- O nome vem do campo "nome" enviado no cadastro (options.data.nome em services/auth.ts).
create function public.criar_perfil_novo_usuario()
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
  return new;
end;
$$;

-- Só o gatilho usa essa função; ninguém chama ela direto pela API
revoke execute on function public.criar_perfil_novo_usuario() from public, anon, authenticated;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();
