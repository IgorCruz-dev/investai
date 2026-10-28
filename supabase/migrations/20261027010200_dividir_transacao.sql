-- Dividir um lançamento: uma parte do valor vira outro lançamento, com categoria própria
-- (ex.: transferência que junta vale-alimentação e reembolso). O original fica com o resto.
-- Funciona também nas importadas do banco: a sincronização soma as partes antes de comparar o valor.
alter table public.transacoes
  add column dividida_de uuid references public.transacoes (id) on delete cascade;
comment on column public.transacoes.dividida_de is
  'Parte separada deste lançamento original. A soma do original com as partes é o valor de verdade.';

create index transacoes_dividida_de_idx on public.transacoes (dividida_de) where dividida_de is not null;

-- Separa as partes (jsonb: [{ "valor": 100.5, "categoria_id": "...", "local": "...", "terceiro": "..." }]).
-- As partes herdam tipo, forma, conta, cartão, data e fatura do original.
-- Roda com as permissões de quem chama (RLS vale). Devolve as partes criadas.
create function public.dividir_transacao(p_id uuid, p_partes jsonb)
returns setof public.transacoes
language plpgsql
set search_path = ''
as $$
declare
  original public.transacoes;
  total numeric;
begin
  select * into original from public.transacoes where id = p_id for update;
  if not found then
    raise exception 'Lançamento não encontrado.' using hint = 'nao_encontrado';
  end if;
  if original.pagamento_cartao_id is not null or original.transferencia_interna or original.caixinha then
    raise exception 'Pagamento de fatura e transferência entre contas não podem ser divididos.' using hint = 'nao_divisivel';
  end if;

  select coalesce(sum((p ->> 'valor')::numeric), 0) into total from jsonb_array_elements(p_partes) p;
  if total <= 0 or total >= original.valor then
    raise exception 'As partes precisam somar menos que o valor do lançamento.' using hint = 'divisao_invalida';
  end if;

  update public.transacoes set valor = valor - total where id = original.id;

  return query
  insert into public.transacoes
    (user_id, tipo, forma, conta_id, cartao_id, categoria_id, local, descricao, valor, data, fatura, terceiro, dividida_de)
  select
    original.user_id,
    original.tipo,
    original.forma,
    original.conta_id,
    original.cartao_id,
    nullif(p ->> 'categoria_id', '')::uuid,
    coalesce(nullif(trim(p ->> 'local'), ''), original.local),
    nullif(trim(p ->> 'descricao'), ''),
    (p ->> 'valor')::numeric,
    original.data,
    original.fatura,
    nullif(trim(p ->> 'terceiro'), ''),
    -- parte de uma parte continua ligada ao original
    coalesce(original.dividida_de, original.id)
  from jsonb_array_elements(p_partes) p
  returning *;
end;
$$;

-- Junta uma parte de volta: o valor volta para o original e a parte some
create function public.desfazer_divisao(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  parte public.transacoes;
begin
  select * into parte from public.transacoes where id = p_id for update;
  if not found or parte.dividida_de is null then
    raise exception 'Este lançamento não é parte de uma divisão.' using hint = 'nao_e_parte';
  end if;
  update public.transacoes set valor = valor + parte.valor where id = parte.dividida_de;
  delete from public.transacoes where id = parte.id;
end;
$$;

revoke execute on function public.dividir_transacao(uuid, jsonb) from public, anon;
grant execute on function public.dividir_transacao(uuid, jsonb) to authenticated;
revoke execute on function public.desfazer_divisao(uuid) from public, anon;
grant execute on function public.desfazer_divisao(uuid) to authenticated;
