-- Saldo das contas no fim de um dia qualquer (ex.: último dia de um mês passado, no Início).
-- Mesma conta do saldo_atual, que passa a ser saldo_em(hoje).
create function public.saldo_em(p_dia date)
returns numeric
language sql
stable
set search_path to ''
as $$
  select
    coalesce((select sum(saldo_inicial) from public.contas where user_id = (select auth.uid())), 0)
    + coalesce((
        select sum(case when t.forma = 'credito' then 0 when t.tipo = 'receita' then t.valor else -t.valor end)
        from public.transacoes t
        where t.user_id = (select auth.uid()) and t.data <= p_dia
      ), 0)
    + coalesce((
        select sum(case when m.tipo = 'retirada' then m.valor else -m.valor end)
        from public.caixinha_movimentos m
        where m.user_id = (select auth.uid()) and m.data <= p_dia and m.transacao_id is null
      ), 0);
$$;

revoke execute on function public.saldo_em(date) from public, anon;
grant execute on function public.saldo_em(date) to authenticated;

create or replace function public.saldo_atual()
returns numeric
language sql
stable
set search_path to ''
as $$
  select public.saldo_em((now() at time zone 'America/Sao_Paulo')::date);
$$;
