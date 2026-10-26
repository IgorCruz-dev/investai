-- Dinheiro guardado na caixinha do banco (despesa) ou resgatado (receita):
-- continua fora das despesas, mas sai das receitas do mês ao guardar e volta ao resgatar
alter table public.transacoes add column caixinha boolean not null default false;
alter table public.transacoes add constraint caixinha_eh_transferencia
  check (not caixinha or transferencia_interna);
comment on column public.transacoes.caixinha is
  'Guardado (despesa) ou resgatado (receita) da caixinha do banco: tira/devolve das receitas do mês.';

-- Marca as aplicações e os resgates da caixinha do Nubank já importados
update public.transacoes set caixinha = true
where origem = 'pluggy' and transferencia_interna
  and descricao ~* '^(aplica[cç][aã]o|resgate) rdb';
