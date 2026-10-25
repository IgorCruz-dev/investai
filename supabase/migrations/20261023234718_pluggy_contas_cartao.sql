-- Dados do cartão que a Pluggy informa, para criar o cartão no app a partir do banco
alter table public.pluggy_contas
  add column bandeira text,
  add column dia_fechamento smallint check (dia_fechamento between 1 and 31),
  add column dia_vencimento smallint check (dia_vencimento between 1 and 31);
