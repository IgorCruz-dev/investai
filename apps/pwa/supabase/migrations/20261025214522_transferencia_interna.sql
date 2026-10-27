-- Transferência entre as próprias contas (ex.: Pix do Bradesco para o Nubank).
-- Continua mexendo no saldo de cada conta, mas fica fora de receitas, despesas e gráficos.
alter table public.transacoes add column transferencia_interna boolean not null default false;
alter table public.transacoes add constraint transferencia_fora_do_credito
  check (not transferencia_interna or (forma <> 'credito' and pagamento_cartao_id is null));
comment on column public.transacoes.transferencia_interna is 'Transferência entre contas do próprio usuário: conta no saldo, não em receitas/despesas.';
