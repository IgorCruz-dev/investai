-- Aplicações e resgates da caixinha do banco (transações com caixinha = true) aparecem na aba Caixinha.
-- Cada uma vira um movimento ligado à transação: aplicação = depósito, resgate = retirada.
-- O saldo da conta já conta a transação; o movimento ligado não desconta de novo.

alter table public.caixinha_movimentos
  add column transacao_id uuid unique references public.transacoes (id) on delete cascade;
comment on column public.caixinha_movimentos.transacao_id is
  'Movimento espelhado de uma transação da caixinha do banco; fica fora do saldo (a transação já conta).';

-- 1) Saldo: movimentos ligados ao banco não contam (a transação de aplicação/resgate já contou)
create or replace function public.saldo_atual()
returns numeric
language sql
stable
set search_path to ''
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as dia)
  select
    coalesce((select sum(saldo_inicial) from public.contas where user_id = (select auth.uid())), 0)
    + coalesce((
        select sum(case when t.forma = 'credito' then 0 when t.tipo = 'receita' then t.valor else -t.valor end)
        from public.transacoes t, hoje
        where t.user_id = (select auth.uid()) and t.data <= hoje.dia
      ), 0)
    + coalesce((
        select sum(case when m.tipo = 'retirada' then m.valor else -m.valor end)
        from public.caixinha_movimentos m, hoje
        where m.user_id = (select auth.uid()) and m.data <= hoje.dia and m.transacao_id is null
      ), 0);
$$;

-- 2) "Caixinha nunca negativa" vale para o que a pessoa lança; resgate do banco já aconteceu
--    (e pode ser de dinheiro guardado antes dos 90 dias importados)
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

-- 3) Espelha as transações da caixinha do banco nos movimentos (cria, atualiza e apaga junto)
create function public.espelhar_caixinha_do_banco()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.caixinha then
    delete from public.caixinha_movimentos where transacao_id = new.id;
    return null;
  end if;

  insert into public.caixinha_movimentos (user_id, tipo, valor, data, motivo, transacao_id)
  values (
    new.user_id,
    case when new.tipo = 'despesa' then 'deposito' else 'retirada' end,
    new.valor,
    new.data,
    case when new.tipo = 'despesa' then null else 'Resgate no banco' end,
    new.id
  )
  on conflict (transacao_id) do update
    set tipo = excluded.tipo, valor = excluded.valor, data = excluded.data, motivo = excluded.motivo;
  return null;
end;
$$;

revoke execute on function public.espelhar_caixinha_do_banco() from public, anon, authenticated;

create trigger espelhar_caixinha_do_banco
  after insert or update of caixinha, tipo, valor, data on public.transacoes
  for each row execute function public.espelhar_caixinha_do_banco();

-- 4) As que já foram importadas
insert into public.caixinha_movimentos (user_id, tipo, valor, data, motivo, transacao_id)
select user_id,
  case when tipo = 'despesa' then 'deposito' else 'retirada' end,
  valor, data,
  case when tipo = 'despesa' then null else 'Resgate no banco' end,
  id
from public.transacoes
where caixinha
on conflict (transacao_id) do nothing;
