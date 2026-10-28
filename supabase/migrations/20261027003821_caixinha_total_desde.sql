-- Total guardado = quanto já tinha na data de partida + movimentos a partir dela.
-- Movimentos anteriores continuam no histórico, mas não entram no total (a importação do banco
-- só pega 90 dias, e resgate de dinheiro guardado antes disso deixaria o total errado).
alter table public.perfis
  add column caixinha_saldo_inicial numeric(12,2) not null default 0,
  add column caixinha_contar_desde date;
comment on column public.perfis.caixinha_saldo_inicial is 'Quanto já estava guardado em caixinha_contar_desde.';
comment on column public.perfis.caixinha_contar_desde is 'Só movimentos a partir desta data entram no total guardado (null = todos).';

-- A trava de caixinha negativa usa o mesmo total
create or replace function public.conferir_total_caixinha()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  usuario uuid := coalesce(new.user_id, old.user_id);
  total numeric;
begin
  if tg_op <> 'DELETE' and new.transacao_id is not null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('caixinha:' || usuario::text, 0));

  select coalesce(p.caixinha_saldo_inicial, 0) + coalesce((
      select sum(case when m.tipo = 'deposito' then m.valor else -m.valor end)
      from public.caixinha_movimentos m
      where m.user_id = usuario and (p.caixinha_contar_desde is null or m.data >= p.caixinha_contar_desde)
    ), 0)
    into total
  from (select 1) _
  left join public.perfis p on p.id = usuario;

  if total < 0 then
    raise exception 'Saldo da caixinha insuficiente: o total guardado ficaria em %', total
      using hint = 'caixinha_insuficiente';
  end if;
  return null;
end;
$$;
