-- O dono não pode mudar implicitamente quando a conta é apagada.
-- Investimentos não têm user_id; sem isto uma nova primeira conta herdaria
-- a carteira antiga. A FK bloqueia a exclusão acidental do dono.
create table public.instalacao (
  unica boolean primary key default true check (unica),
  dono uuid not null unique references auth.users (id) on delete restrict,
  criado_em timestamptz not null default now()
);

alter table public.instalacao enable row level security;

insert into public.instalacao (dono)
select id from auth.users order by created_at, id limit 1;

create function public.registrar_dono()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.instalacao (dono) values (new.id);
  return new;
end $$;

revoke execute on function public.registrar_dono()
  from public, anon, authenticated;

create trigger auth_registra_dono
after insert on auth.users
for each row execute function public.registrar_dono();

create or replace function public.meu_usuario()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select dono from public.instalacao where unica;
$$;

create or replace function public.cadastro_disponivel()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.instalacao);
$$;

create or replace function public.exigir_usuario_unico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(60590127);
  if exists (select 1 from auth.users)
     or exists (select 1 from public.instalacao) then
    raise exception 'esta instalação já possui uma conta'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
