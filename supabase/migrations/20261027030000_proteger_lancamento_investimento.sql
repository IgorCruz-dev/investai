-- Impede que uma edição no extrato quebre a costura com o ledger.
-- O gatilho de movimentacoes pode atualizar/remover a linha espelhada;
-- ações diretas em transacoes não podem alterar seus dados econômicos.
create function public.proteger_lancamento_investimento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.movimentacao_id is null or pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'edite ou exclua a movimentação na aba Investimentos'
      using errcode = 'check_violation';
  end if;

  if old.tipo is distinct from new.tipo
     or old.valor is distinct from new.valor
     or old.data is distinct from new.data
     or old.descricao is distinct from new.descricao
     or old.categoria_id is distinct from new.categoria_id
     or old.origem is distinct from new.origem
     or old.movimentacao_id is distinct from new.movimentacao_id then
    raise exception 'edite os dados da compra ou venda na aba Investimentos'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

revoke execute on function public.proteger_lancamento_investimento()
  from public, anon, authenticated;

create trigger transacoes_protege_investimento
before update or delete on public.transacoes
for each row execute function public.proteger_lancamento_investimento();
