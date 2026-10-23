-- Etapa 2: ajustes em transacoes para o cadastro de lançamentos + função de saldo.

-- 1) Descrição passa a ser opcional (no formulário, o "local" faz o papel de nome do gasto)
alter table public.transacoes alter column descricao drop not null;
alter table public.transacoes drop constraint transacoes_descricao_check;

-- 2) Compra no crédito precisa dizer onde foi
alter table public.transacoes add constraint local_obrigatorio_no_credito
  check (forma <> 'credito' or length(trim(coalesce(local, ''))) > 0);

-- 3) Fatura em que cada compra/parcela do crédito cai: dia 1 do mês de VENCIMENTO da fatura.
--    Fica gravada para não depender de recalcular pela data (que falha em meses curtos).
alter table public.transacoes add column fatura date;
alter table public.transacoes add constraint fatura_so_no_credito check ((forma = 'credito') = (fatura is not null));
alter table public.transacoes add constraint fatura_no_dia_1 check (extract(day from fatura) = 1);
comment on column public.transacoes.fatura is 'Só no crédito: dia 1 do mês de vencimento da fatura em que a compra/parcela cai.';

-- 4) Saldo atual = saldo inicial das contas + receitas − despesas que não são crédito
--                  − depósitos na caixinha + retiradas da caixinha (só até hoje, no horário de Brasília).
--    Roda com as permissões de quem chama (RLS vale), então cada um só soma o que é seu.
create function public.saldo_atual()
returns numeric
language sql
stable
set search_path = ''
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as dia)
  select
    coalesce((select sum(saldo_inicial) from public.contas where user_id = (select auth.uid())), 0)
    + coalesce((
        select sum(case when t.tipo = 'receita' then t.valor when t.forma <> 'credito' then -t.valor else 0 end)
        from public.transacoes t, hoje
        where t.user_id = (select auth.uid()) and t.data <= hoje.dia
      ), 0)
    + coalesce((
        select sum(case when m.tipo = 'retirada' then m.valor else -m.valor end)
        from public.caixinha_movimentos m, hoje
        where m.user_id = (select auth.uid()) and m.data <= hoje.dia
      ), 0);
$$;

revoke execute on function public.saldo_atual() from public, anon;
grant execute on function public.saldo_atual() to authenticated;
