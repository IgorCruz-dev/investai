-- Lançamento de outra pessoa: compra que alguém fez no meu cartão, dinheiro que me mandaram
-- para pagar algo dela, parcela de empréstimo que pago por ela...
-- Continua no saldo e na fatura (o dinheiro passou por mim), mas fica fora das minhas
-- receitas, despesas e gráficos. A tela de Acertos soma o que cada pessoa me deve.
alter table public.transacoes
  add column terceiro text check (terceiro is null or length(trim(terceiro)) > 0);
alter table public.transacoes add constraint terceiro_fora_de_transferencia
  check (terceiro is null or (not transferencia_interna and pagamento_cartao_id is null));
comment on column public.transacoes.terceiro is
  'Nome da pessoa a quem o lançamento pertence; fora das minhas receitas e despesas.';

create index transacoes_user_terceiro_idx on public.transacoes (user_id, terceiro) where terceiro is not null;

-- Regra por local também pode dizer de quem é (ex.: toda transferência da mãe)
alter table public.regras_categoria_local
  add column terceiro text check (terceiro is null or length(trim(terceiro)) > 0);
comment on column public.regras_categoria_local.terceiro is
  'Se preenchido, as importadas deste local entram como lançamento desta pessoa.';
