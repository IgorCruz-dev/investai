-- Etapa 5: lançamento automático das assinaturas, sem duplicar.

-- 1) Liga cada cobrança à assinatura que a gerou
alter table public.assinaturas add constraint assinaturas_id_user_id_key unique (id, user_id);

alter table public.transacoes add column assinatura_id uuid;
alter table public.transacoes
  add constraint transacoes_assinatura_id_user_id_fkey
    foreign key (assinatura_id, user_id) references public.assinaturas (id, user_id) on delete set null (assinatura_id);
comment on column public.transacoes.assinatura_id is 'Assinatura que gerou esta cobrança (lançamento automático).';

-- Trava final contra duplicidade: no máximo uma cobrança por assinatura em cada mês
create unique index transacoes_assinatura_mes_unico
  on public.transacoes (assinatura_id, (date_trunc('month', data::timestamp)))
  where assinatura_id is not null;

-- 2) Mesma regra de fatura do app (src/lib/fatura.ts → mesDaFatura):
--    compras a partir do dia do fechamento vão para a fatura seguinte; se vence antes/no dia do
--    fechamento, a fatura vence no mês seguinte. Devolve o dia 1 do mês de vencimento.
create function public.mes_da_fatura(p_data date, p_fechamento integer, p_vencimento integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (
    date_trunc('month', p_data)
    + make_interval(months =>
        (case when extract(day from p_data)
                   >= least(p_fechamento, extract(day from date_trunc('month', p_data) + interval '1 month - 1 day'))
              then 1 else 0 end)
        + (case when p_vencimento <= p_fechamento then 1 else 0 end))
  )::date;
$$;

-- 3) Lança as cobranças do mês que já chegaram e ainda não foram lançadas.
--    - Data da cobrança: dia_cobranca do mês atual (ou o último dia, se o mês for mais curto).
--    - Já lançada no mês (ultimo_lancamento neste mês)? Pula.
--    - Com cartão: crédito, na fatura certa. Sem cartão: débito (na conta, se houver só uma).
--    - Categoria: a da assinatura ou, se não tiver, a categoria "Assinaturas" do usuário.
--    - "for update" trava cada assinatura: duas chamadas ao mesmo tempo não lançam em dobro.
--    Roda com as permissões de quem chama (RLS vale). Devolve quantas cobranças lançou.
create function public.lancar_assinaturas_pendentes()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  usuario uuid := (select auth.uid());
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  inicio_mes date := date_trunc('month', hoje)::date;
  ultimo_dia integer := extract(day from inicio_mes + interval '1 month - 1 day')::integer;
  categoria_padrao uuid;
  conta_unica uuid;
  a record;
  cobranca date;
  lancadas integer := 0;
begin
  if usuario is null then
    return 0;
  end if;

  select id into categoria_padrao
  from public.categorias
  where user_id = usuario and icone = 'assinaturas'
  order by criado_em
  limit 1;

  if (select count(*) from public.contas where user_id = usuario) = 1 then
    select id into conta_unica from public.contas where user_id = usuario;
  end if;

  for a in
    select s.id, s.user_id, s.nome, s.valor, s.dia_cobranca, s.categoria_id, s.cartao_id, s.ultimo_lancamento,
           c.dia_fechamento, c.dia_vencimento
    from public.assinaturas s
    left join public.cartoes c on c.id = s.cartao_id and c.user_id = s.user_id
    where s.user_id = usuario and s.ativa
    for update of s
  loop
    cobranca := inicio_mes + (least(a.dia_cobranca, ultimo_dia) - 1);
    continue when cobranca > hoje;
    continue when a.ultimo_lancamento is not null and a.ultimo_lancamento >= inicio_mes;

    insert into public.transacoes
      (user_id, tipo, forma, conta_id, cartao_id, categoria_id, local, descricao, valor, data, fatura, assinatura_id)
    values (
      a.user_id,
      'despesa',
      case when a.cartao_id is null then 'debito' else 'credito' end,
      case when a.cartao_id is null then conta_unica end,
      a.cartao_id,
      coalesce(a.categoria_id, categoria_padrao),
      a.nome,
      'Assinatura (lançada automaticamente)',
      a.valor,
      cobranca,
      case when a.cartao_id is not null then public.mes_da_fatura(cobranca, a.dia_fechamento, a.dia_vencimento) end,
      a.id
    );

    update public.assinaturas set ultimo_lancamento = cobranca where id = a.id;
    lancadas := lancadas + 1;
  end loop;

  return lancadas;
end;
$$;

revoke execute on function public.mes_da_fatura(date, integer, integer) from public, anon;
grant execute on function public.mes_da_fatura(date, integer, integer) to authenticated;
revoke execute on function public.lancar_assinaturas_pendentes() from public, anon;
grant execute on function public.lancar_assinaturas_pendentes() to authenticated;
