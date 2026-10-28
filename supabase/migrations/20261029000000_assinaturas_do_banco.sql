-- Assinaturas que vêm do banco: toda despesa importada na categoria Assinaturas vira (ou entra numa) assinatura
-- recorrente, reconhecida pelo local da cobrança. Ela fica ativa até o usuário pausar; o app não lança essas
-- sozinho (o banco já traz a cobrança), só liga cada cobrança à assinatura e atualiza valor e dia.
alter table public.assinaturas
  add column chave text check (chave is null or (chave = lower(trim(chave)) and length(chave) > 0)),
  add column do_banco boolean not null default false,
  add column total_parcelas smallint check (total_parcelas is null or total_parcelas between 1 and 360);

comment on column public.assinaturas.chave is 'Local das cobranças (minúsculo) usado para reconhecer as que chegam do banco.';
comment on column public.assinaturas.do_banco is 'A cobrança vem do banco: não é lançada automaticamente, só reconhecida.';
comment on column public.assinaturas.total_parcelas is 'Quantas cobranças ao todo (ex.: financiamento); null = sem fim.';

create unique index assinaturas_user_chave_uidx on public.assinaturas (user_id, chave) where chave is not null;

create or replace function public.vincular_assinatura()
  returns trigger
  language plpgsql
  set search_path to ''
as $$
declare
  k text;
  a_id uuid;
begin
  -- Só despesas minhas, inteiras e sem parcelamento do cartão (compra parcelada já tem fim)
  if new.tipo <> 'despesa' or new.terceiro is not null or new.dividida_de is not null
     or new.total_parcelas is not null or new.local is null or length(trim(new.local)) = 0
     or new.transferencia_interna or new.pagamento_cartao_id is not null then
    return new;
  end if;
  -- Já ligada (ex.: lançada pela própria assinatura)
  if new.assinatura_id is not null then
    return new;
  end if;

  k := lower(trim(new.local));
  select id into a_id from public.assinaturas where user_id = new.user_id and chave = k;

  if a_id is null then
    if not exists (select 1 from public.categorias where id = new.categoria_id and icone = 'assinaturas') then
      return new;
    end if;
    insert into public.assinaturas (user_id, nome, valor, dia_cobranca, categoria_id, cartao_id, ultimo_lancamento, chave, do_banco)
    values (new.user_id, left(trim(new.local), 40), new.valor, extract(day from new.data)::smallint, new.categoria_id,
            new.cartao_id, new.data, k, true)
    on conflict (user_id, chave) where chave is not null do nothing
    returning id into a_id;
    if a_id is null then
      select id into a_id from public.assinaturas where user_id = new.user_id and chave = k;
    end if;
  else
    -- A cobrança mais recente manda no valor e no dia
    update public.assinaturas
    set valor = new.valor,
        dia_cobranca = extract(day from new.data)::smallint,
        ultimo_lancamento = new.data,
        cartao_id = coalesce(new.cartao_id, cartao_id)
    where id = a_id and do_banco and (ultimo_lancamento is null or new.data >= ultimo_lancamento);
  end if;

  -- Uma cobrança por mês em cada assinatura: as que sobram no mesmo mês ficam soltas
  if not exists (
    select 1 from public.transacoes
    where assinatura_id = a_id and id <> new.id and date_trunc('month', data) = date_trunc('month', new.data)
  ) then
    new.assinatura_id := a_id;
  end if;
  return new;
end;
$$;

create trigger vincular_assinatura
  before insert or update of categoria_id, local, valor, data on public.transacoes
  for each row execute function public.vincular_assinatura();

-- As do banco não são lançadas pelo app
create or replace function public.lancar_assinaturas_pendentes()
 returns integer
 language plpgsql
 set search_path to ''
as $function$
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
    where s.user_id = usuario and s.ativa and not s.do_banco
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
$function$;

-- Liga o que já foi importado (da mais antiga para a mais nova, para a última cobrança mandar)
do $$
declare
  t record;
begin
  for t in
    select tr.id from public.transacoes tr
    join public.categorias c on c.id = tr.categoria_id
    where c.icone = 'assinaturas' and tr.assinatura_id is null
    order by tr.data, tr.criado_em
  loop
    update public.transacoes set local = local where id = t.id;
  end loop;
end;
$$;
