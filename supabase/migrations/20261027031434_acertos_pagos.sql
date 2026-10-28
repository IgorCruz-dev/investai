-- Mês de acerto marcado como pago à mão (ex.: a pessoa pagou em dinheiro).
-- O que ela devia nesse mês sai do saldo dos Acertos; os lançamentos continuam como estão.
create table public.acertos_pagos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pessoa text not null check (length(trim(pessoa)) > 0),
  -- dia 1 do mês (o mesmo mês do "Mês a mês": vencimento da fatura ou data)
  mes date not null check (extract(day from mes) = 1),
  criado_em timestamptz not null default now(),
  unique (user_id, pessoa, mes)
);

alter table public.acertos_pagos enable row level security;
create policy "Ver os próprios" on public.acertos_pagos for select to authenticated using ((select auth.uid()) = user_id);
create policy "Criar os próprios" on public.acertos_pagos for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Apagar os próprios" on public.acertos_pagos for delete to authenticated using ((select auth.uid()) = user_id);
