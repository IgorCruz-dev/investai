-- Crédito lançado no cartão (estorno, crédito de rotativo) abate a fatura; não é dinheiro na conta.
-- Antes só as despesas no crédito ficavam de fora; agora as receitas no crédito também.
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
        where m.user_id = (select auth.uid()) and m.data <= hoje.dia
      ), 0);
$$;
