-- Empréstimo com outra pessoa (ela me emprestou ou eu emprestei): nos Acertos não zera quando o mês fecha,
-- fica em aberto até ser devolvido
alter table public.transacoes add column emprestimo boolean not null default false;
