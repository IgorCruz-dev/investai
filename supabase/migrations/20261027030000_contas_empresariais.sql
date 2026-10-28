-- Conta e cartão da empresa: ficam fora das finanças pessoais (saldo, receitas e despesas)
-- e aparecem num card separado no Início.
alter table public.contas add column empresarial boolean not null default false;
alter table public.cartoes add column empresarial boolean not null default false;
comment on column public.contas.empresarial is 'Conta da empresa: fora do saldo e do resumo pessoal.';
comment on column public.cartoes.empresarial is 'Cartão da empresa: as compras são despesas da empresa.';

-- Saldo no fim de um dia, das contas pessoais (padrão) ou das empresariais.
-- Lançamento sem conta e caixinha contam como pessoais.
drop function public.saldo_em(date);
create function public.saldo_em(p_dia date, p_empresarial boolean default false)
returns numeric
language sql
stable
set search_path to ''
as $$
  select
    coalesce((
        select sum(saldo_inicial) from public.contas
        where user_id = (select auth.uid()) and empresarial = p_empresarial
      ), 0)
    + coalesce((
        select sum(case when t.forma = 'credito' then 0 when t.tipo = 'receita' then t.valor else -t.valor end)
        from public.transacoes t
        left join public.contas c on c.id = t.conta_id
        where t.user_id = (select auth.uid()) and t.data <= p_dia and coalesce(c.empresarial, false) = p_empresarial
      ), 0)
    + case when p_empresarial then 0 else coalesce((
        select sum(case when m.tipo = 'retirada' then m.valor else -m.valor end)
        from public.caixinha_movimentos m
        where m.user_id = (select auth.uid()) and m.data <= p_dia and m.transacao_id is null
      ), 0) end;
$$;

revoke execute on function public.saldo_em(date, boolean) from public, anon;
grant execute on function public.saldo_em(date, boolean) to authenticated;

-- Saldo atual = das contas pessoais
create or replace function public.saldo_atual()
returns numeric
language sql
stable
set search_path to ''
as $$
  select public.saldo_em((now() at time zone 'America/Sao_Paulo')::date);
$$;
