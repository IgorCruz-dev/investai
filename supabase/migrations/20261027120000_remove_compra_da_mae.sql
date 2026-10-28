-- "Compra da minha mãe" saiu: as compras dela agora são lançamentos de outra pessoa (terceiro = 'Mãe'),
-- marcados pela tela de Acertos. As marcadas foram passadas para terceiro antes de apagar a coluna.
alter table public.transacoes drop constraint da_mae_so_compra_no_credito;
alter table public.transacoes drop column da_mae;
