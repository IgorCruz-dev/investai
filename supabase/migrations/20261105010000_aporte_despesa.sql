-- A costura (spec 004): comprar ação é uma despesa na categoria Investimento.
--
-- Sem isso, comprar R$ 500 de VALE3 exige duas anotações do mesmo fato — uma em
-- `movimentacoes` e uma em `transacoes` — que divergem na primeira vez que uma
-- for esquecida.
--
-- A regra mora no banco, e não em Python, porque existem TRÊS caminhos de
-- escrita: o bot do WhatsApp, o PWA pelo supabase-js e eu mesmo no psql. Regra
-- em Python cobriria só o primeiro, e o PWA escrevendo direto criaria posição
-- sem despesa, silenciosamente.

-- ===================== a categoria =====================
-- As categorias padrão não tinham Investimento.
create or replace function public.criar_categorias_padrao(p_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.categorias (user_id, nome, cor, icone) values
    (p_user_id, 'Comida',        '#f97316', 'comida'),
    (p_user_id, 'Eletrônicos',   '#6366f1', 'eletronicos'),
    (p_user_id, 'Faculdade',     '#0ea5e9', 'faculdade'),
    (p_user_id, 'Transporte',    '#eab308', 'transporte'),
    (p_user_id, 'Saúde',         '#ef4444', 'saude'),
    (p_user_id, 'Lazer',         '#ec4899', 'lazer'),
    (p_user_id, 'Casa',          '#14b8a6', 'casa'),
    (p_user_id, 'Roupas',        '#a855f7', 'roupas'),
    (p_user_id, 'Assinaturas',   '#8b5cf6', 'assinaturas'),
    (p_user_id, 'Investimento',  '#d4af37', 'investimento'),
    -- #64748b desaparecia no fundo escuro; este é o --cor-texto-suave do tema.
    (p_user_id, 'Outros',        '#8a8a9a', 'outros')
  on conflict (user_id, nome) do nothing;
$$;

revoke execute on function public.criar_categorias_padrao(uuid) from public, anon, authenticated;

-- Para quem já existe
insert into public.categorias (user_id, nome, cor, icone)
select id, 'Investimento', '#d4af37', 'investimento' from auth.users
on conflict (user_id, nome) do nothing;

-- ===================== o vínculo =====================
-- O lançamento guarda qual movimentação o criou. Serve para duas coisas:
-- responder "por que essa despesa de R$ 2.340 apareceu no meu mês?" e permitir
-- que apagar a compra apague a despesa, pela própria chave estrangeira.
alter table public.transacoes
  add column movimentacao_id bigint
    references public.movimentacoes (id) on delete cascade,
  add constraint transacoes_movimentacao_unica unique (movimentacao_id);

comment on column public.transacoes.movimentacao_id is
  'Compra/venda de ativo que gerou este lançamento (spec 004). Apagar a movimentação apaga o lançamento.';

-- `origem` ganha um valor próprio: o lançamento não foi digitado à mão nem veio
-- do banco pela Pluggy — ele é reflexo de uma movimentação.
alter table public.transacoes drop constraint transacoes_origem_check;
alter table public.transacoes add constraint transacoes_origem_check
  check (origem in ('manual', 'pluggy', 'investimento'));

-- ===================== o gatilho =====================
-- security definer: resolve o dono do sistema e escreve em transacoes também
-- quando o chamador é o Python da VM, que conecta sem sessão.
create function public.espelhar_movimentacao_em_lancamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  usuario   uuid;
  categoria uuid;
  valor     numeric(12, 2);
  tipo_lanc text;
begin
  -- Apagar a movimentação já apaga o lançamento, pela chave estrangeira.
  if tg_op = 'DELETE' then
    return old;
  end if;

  -- A exceção que protege o histórico: posição importada no onboarding (ou numa
  -- migração) teve o dinheiro saindo da conta ANTES de o sistema existir. Criar
  -- despesa retroativa colocaria dezenas de milhares de reais de gasto num mês
  -- que não teve esse gasto. Só compra e venda declaradas no momento em que
  -- aconteceram entram na costura.
  if new.origem not in ('web', 'whatsapp') or new.tipo not in ('compra', 'venda') then
    if tg_op = 'UPDATE' then
      delete from public.transacoes where movimentacao_id = new.id;
    end if;
    return new;
  end if;

  usuario := public.meu_usuario();
  if usuario is null then
    return new;  -- ninguém cadastrado ainda; não há em nome de quem lançar
  end if;

  tipo_lanc := case when new.tipo = 'compra' then 'despesa' else 'receita' end;

  -- Compra: saiu da conta o valor das cotas MAIS as taxas.
  -- Venda:  entrou na conta o valor das cotas MENOS as taxas.
  valor := round(
    new.shares * new.preco
    + case when new.tipo = 'compra' then new.taxas else -new.taxas end
  , 2);

  -- Venda cujas taxas consomem o valor todo não vira receita de valor zero ou
  -- negativo: `transacoes` exige valor > 0, e forçar 0,01 seria inventar número.
  if valor <= 0 then
    if tg_op = 'UPDATE' then
      delete from public.transacoes where movimentacao_id = new.id;
    end if;
    return new;
  end if;

  select id into categoria
  from public.categorias
  where user_id = usuario and nome = 'Investimento'
  limit 1;

  insert into public.transacoes
    (user_id, tipo, forma, categoria_id, descricao, valor, data, origem, movimentacao_id)
  values (
    usuario,
    tipo_lanc,
    'pix',  -- transferência para corretora é Pix na prática esmagadora dos casos
    categoria,
    initcap(new.tipo) || ' de '
      || trim(to_char(new.shares, 'FM999999999990.999999')) || ' ' || new.ticker,
    valor,
    new.data,
    'investimento',
    new.id
  )
  on conflict (movimentacao_id) do update set
    tipo         = excluded.tipo,
    valor        = excluded.valor,
    data         = excluded.data,
    descricao    = excluded.descricao,
    categoria_id = excluded.categoria_id;

  return new;
end $$;

comment on function public.espelhar_movimentacao_em_lancamento() is
  'Spec 004: compra declarada vira despesa, venda vira receita, na categoria Investimento.';

revoke execute on function public.espelhar_movimentacao_em_lancamento()
  from public, anon, authenticated;

create trigger movimentacoes_espelha_lancamento
after insert or update on public.movimentacoes
for each row execute function public.espelhar_movimentacao_em_lancamento();
