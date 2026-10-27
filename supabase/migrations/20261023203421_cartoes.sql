-- Etapa 4: pagamento de fatura e limite usado dos cartões.

-- 1) Pagamento de fatura: é uma despesa fora do crédito (débito) marcada com o cartão
--    e o mês da fatura que ela quita. Se existe, a fatura está "Paga".
alter table public.transacoes
  add column pagamento_cartao_id uuid,
  add column pagamento_fatura date;

alter table public.transacoes
  add constraint transacoes_pagamento_cartao_id_user_id_fkey
    foreign key (pagamento_cartao_id, user_id) references public.cartoes (id, user_id) on delete restrict,
  -- os dois campos andam juntos
  add constraint pagamento_fatura_completo check ((pagamento_cartao_id is null) = (pagamento_fatura is null)),
  -- pagamento é sempre uma despesa que sai da conta (não pode ser no crédito)
  add constraint pagamento_fatura_fora_do_credito check (pagamento_cartao_id is null or (tipo = 'despesa' and forma <> 'credito')),
  add constraint pagamento_fatura_no_dia_1 check (extract(day from pagamento_fatura) = 1);

comment on column public.transacoes.pagamento_cartao_id is 'Preenchido quando a transação é o pagamento de uma fatura deste cartão.';
comment on column public.transacoes.pagamento_fatura is 'Fatura (dia 1 do mês de vencimento) que este pagamento quita.';

-- Uma fatura só pode ser paga uma vez
create unique index transacoes_pagamento_unico
  on public.transacoes (user_id, pagamento_cartao_id, pagamento_fatura)
  where pagamento_cartao_id is not null;

-- Consulta das transações de uma fatura (tela do cartão)
create index transacoes_user_cartao_fatura_idx
  on public.transacoes (user_id, cartao_id, fatura)
  where cartao_id is not null;

-- 2) Limite usado por cartão = compras no crédito em faturas ainda não pagas
--    (todas as parcelas em aberto, não só a fatura atual). RLS vale: cada um só vê o seu.
create function public.limite_usado_cartoes()
returns table (cartao_id uuid, usado numeric)
language sql
stable
set search_path = ''
as $$
  select t.cartao_id, sum(t.valor) as usado
  from public.transacoes t
  where t.user_id = (select auth.uid())
    and t.forma = 'credito'
    and t.tipo = 'despesa'
    and not exists (
      select 1 from public.transacoes p
      where p.user_id = t.user_id
        and p.pagamento_cartao_id = t.cartao_id
        and p.pagamento_fatura = t.fatura
    )
  group by t.cartao_id;
$$;

revoke execute on function public.limite_usado_cartoes() from public, anon;
grant execute on function public.limite_usado_cartoes() to authenticated;
