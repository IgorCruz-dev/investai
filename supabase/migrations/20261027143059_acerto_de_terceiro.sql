-- Dinheiro que a pessoa mandou para acertar um mês: continua sendo receita dela (terceiro), mas a
-- tela de Acertos conta no mês que ela está acertando, não no mês em que o Pix caiu — ela pode
-- pagar adiantado ou atrasado. Dia 1 do mês, como a fatura.
alter table public.transacoes add column acerto_mes date;
alter table public.transacoes add constraint acerto_mes_no_dia_1
  check (acerto_mes is null or extract(day from acerto_mes) = 1);
alter table public.transacoes add constraint acerto_mes_so_no_que_a_pessoa_mandou
  check (acerto_mes is null or (terceiro is not null and tipo = 'receita' and forma <> 'credito'));
comment on column public.transacoes.acerto_mes is
  'Só no que a pessoa mandou: dia 1 do mês que o pagamento acerta (a tela de Acertos conta nele).';
