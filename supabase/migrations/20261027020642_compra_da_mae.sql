-- Compra no cartão feita para a mãe: entra no quanto ela deve na fatura
alter table public.transacoes add column da_mae boolean not null default false;
alter table public.transacoes add constraint da_mae_so_compra_no_credito
  check (not da_mae or (forma = 'credito' and tipo = 'despesa'));
comment on column public.transacoes.da_mae is
  'Compra no cartão que é da mãe: entra no quanto ela deve na fatura.';

-- Marca as compras que já têm "mae"/"mãe" no nome (ex.: "PDV AZ TINTAS A 018 - mae")
update public.transacoes set da_mae = true
where forma = 'credito' and tipo = 'despesa'
  and local ~* '(^|[^a-z])m[aã]e([^a-z]|$)';
