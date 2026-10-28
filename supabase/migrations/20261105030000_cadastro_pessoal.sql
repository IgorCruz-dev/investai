-- Instância pessoal: o primeiro cadastro é o dono da carteira e do PWA.
-- O lock impede duas inscrições simultâneas de passarem pela checagem.
create function public.exigir_usuario_unico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(60590127);
  if exists (select 1 from auth.users) then
    raise exception 'esta instalação já possui uma conta'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke execute on function public.exigir_usuario_unico()
  from public, anon, authenticated;

create trigger auth_usuario_unico
before insert on auth.users
for each row execute function public.exigir_usuario_unico();

-- A tela de login mostra o link de cadastro apenas até existir um dono.
create function public.cadastro_disponivel()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from auth.users);
$$;

revoke execute on function public.cadastro_disponivel() from public;
grant execute on function public.cadastro_disponivel() to anon, authenticated;
