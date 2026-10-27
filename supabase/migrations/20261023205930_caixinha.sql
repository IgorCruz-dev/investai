-- Etapa 7: caixinha nunca fica negativa + meta de valor.

-- 1) Depois de qualquer mudança nos movimentos, o total guardado (depósitos − retiradas)
--    não pode ficar negativo. A trava (advisory lock por usuário) faz duas retiradas
--    ao mesmo tempo serem conferidas uma depois da outra.
--    Roda com as permissões de quem chama (RLS vale): soma só os movimentos do próprio usuário.
create function public.conferir_total_caixinha()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  usuario uuid := coalesce(new.user_id, old.user_id);
  total numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('caixinha:' || usuario::text, 0));

  select coalesce(sum(case when tipo = 'deposito' then valor else -valor end), 0)
    into total
  from public.caixinha_movimentos
  where user_id = usuario;

  if total < 0 then
    raise exception 'Saldo da caixinha insuficiente: o total guardado ficaria em %', total
      using hint = 'caixinha_insuficiente';
  end if;
  return null;
end;
$$;

revoke execute on function public.conferir_total_caixinha() from public, anon, authenticated;

create trigger conferir_total_caixinha
  after insert or update or delete on public.caixinha_movimentos
  for each row execute function public.conferir_total_caixinha();

-- Histórico da caixinha (lista por data)
create index caixinha_movimentos_user_data_idx on public.caixinha_movimentos (user_id, data);

-- 2) Meta opcional de valor guardado (fica no perfil; RLS do perfil já vale)
alter table public.perfis add column meta_caixinha numeric(12,2) check (meta_caixinha > 0);
comment on column public.perfis.meta_caixinha is 'Meta opcional de valor guardado na caixinha.';
