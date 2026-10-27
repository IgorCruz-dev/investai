-- Categoria original da Pluggy em cada transação importada: alimenta a tela de mapeamento
-- e permite aplicar um mapeamento novo às transações que já entraram.
alter table public.transacoes add column categoria_pluggy text;
comment on column public.transacoes.categoria_pluggy is 'Só nas importadas: categoria da Pluggy (em inglês), como veio do banco.';
