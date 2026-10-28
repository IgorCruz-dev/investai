-- Fatura pode ser paga em partes: vários pagamentos para a mesma fatura.
-- Ela fica "Paga" quando a soma dos pagamentos chega no valor da fatura.
drop index public.transacoes_pagamento_unico;

create index transacoes_pagamento_fatura_idx
  on public.transacoes (user_id, pagamento_cartao_id, pagamento_fatura)
  where pagamento_cartao_id is not null;

-- Limite usado por cartão = o que ainda falta pagar de cada fatura
-- (compras − créditos no cartão − pagamentos), nunca negativo. RLS vale: cada um só vê o seu.
create or replace function public.limite_usado_cartoes()
returns table (cartao_id uuid, usado numeric)
language sql
stable
set search_path = ''
as $$
  with movimentos as (
    select t.cartao_id, t.fatura, case when t.tipo = 'despesa' then t.valor else -t.valor end as valor
    from public.transacoes t
    where t.user_id = (select auth.uid()) and t.forma = 'credito'
    union all
    select p.pagamento_cartao_id, p.pagamento_fatura, -p.valor
    from public.transacoes p
    where p.user_id = (select auth.uid()) and p.pagamento_cartao_id is not null
  ),
  por_fatura as (
    select m.cartao_id, m.fatura, sum(m.valor) as falta
    from movimentos m
    group by m.cartao_id, m.fatura
  )
  select f.cartao_id, sum(greatest(f.falta, 0)) as usado
  from por_fatura f
  group by f.cartao_id;
$$;
