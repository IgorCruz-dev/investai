-- Investimentos: as tabelas do InvestAI portadas do Neon para o Supabase.
--
-- A ideia central não muda: `movimentacoes` é a verdade e `posicoes` é derivada
-- dela por replay. Ninguém escreve em `posicoes` à mão — só o gatilho escreve.
--
-- Três decisões desta migração (spec 001, Fase 2):
--
-- 1. `perfil` virou `perfil_investidor`. O lado financeiro tem `perfis`
--    (contas de usuário); duas tabelas no mesmo schema separadas por uma letra,
--    com significados sem relação, é armadilha pronta.
--
-- 2. Sem coluna `user_id`. O schema já é de uma pessoa por desenho —
--    `posicoes` tem `ticker` como chave primária e o perfil é `check (id = 1)` —
--    e isso agora combina com a decisão de uso pessoal em vez de brigar com ela.
--    O isolamento é a política de RLS, não uma coluna que alguém pode esquecer
--    no `where`.
--
-- 3. `tentativas_login` não foi portada: quem cuida de login agora é o
--    Supabase Auth.

-- ===================== quem sou eu =====================
-- O sistema tem um usuário. Mas existem dois caminhos de escrita com contextos
-- diferentes: o PWA chega autenticado (auth.uid() preenchido) e o Python da VM
-- conecta direto no Postgres, sem sessão (auth.uid() nulo).
--
-- O primeiro cadastro é o dono da instalação. A função devolve esse usuário
-- tanto para o PWA quanto para a VM; as policies abaixo conferem a sessão do
-- PWA contra ele. Um segundo cadastro no Auth não ganha acesso à carteira.
create function public.meu_usuario()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users order by created_at, id limit 1;
$$;

comment on function public.meu_usuario() is
  'O dono da instalação: o primeiro usuário cadastrado no Auth.';

revoke execute on function public.meu_usuario() from public, anon;
grant execute on function public.meu_usuario() to authenticated;

-- ===================== ativos =====================
-- Catálogo. Um ticker novo entra com validado=false e o cron da VM confere no
-- yfinance. Só a VM pode validar (é yfinance), então a web grava otimista e espera.
create table public.ativos (
  ticker     text primary key,
  nome       text,
  classe     text not null default 'acao'
             check (classe in ('acao', 'etf', 'fii', 'renda_fixa')),
  setor      text,
  validado   boolean not null default false,
  invalido   boolean not null default false,
  conferido  timestamptz
);

-- ===================== movimentacoes =====================
-- O ledger. Append-only no espírito, mas editável e removível de propósito:
-- corrigir um preço digitado errado três meses atrás é um caso real, e o replay
-- recompõe a posição sozinho.
--
-- `origem` ganhou 'onboarding' (spec 002): é o que distingue a posição que já
-- existia antes do sistema da compra declarada agora — e é o que a spec 004 usa
-- para NÃO criar despesa retroativa.
create table public.movimentacoes (
  id      bigserial primary key,
  tipo    text   not null check (tipo in ('compra', 'venda', 'ajuste')),
  ticker  text   not null references public.ativos (ticker),
  shares  numeric(18, 8) not null check (shares > 0),
  preco   numeric(18, 6) not null check (preco >= 0),
  taxas   numeric(18, 6) not null default 0 check (taxas >= 0),
  data    date   not null default current_date,
  origem  text   not null check (origem in ('web', 'whatsapp', 'migracao', 'onboarding')),
  nota    text,
  criado  timestamptz not null default now()
);

create index movimentacoes_replay_idx  on public.movimentacoes (ticker, data, id);
create index movimentacoes_extrato_idx on public.movimentacoes (data desc, id desc);

-- ===================== posicoes =====================
-- Derivada. Nunca escrita à mão.
create table public.posicoes (
  ticker        text primary key references public.ativos (ticker),
  shares        numeric(18, 8) not null check (shares >= 0),
  avg_price     numeric(18, 6),
  custo_total   numeric(18, 2) not null default 0,
  pnl_realizado numeric(18, 2) not null default 0,
  atualizado    timestamptz not null default now()
);

-- ===================== perfil do investidor =====================
create table public.perfil_investidor (
  id         int primary key default 1 check (id = 1),
  respostas  jsonb not null,
  derivado   jsonb not null,
  atualizado timestamptz not null default now()
);

comment on table public.perfil_investidor is
  'As 18 respostas do questionário e o perfil derivado delas. Uma linha, sempre id = 1.';

-- ===================== snapshots =====================
create table public.snapshots (
  id        bigserial primary key,
  gerado_em timestamptz not null default now(),
  payload   jsonb not null
);
create index snapshots_recente_idx on public.snapshots (gerado_em desc);

-- ===================== jobs =====================
-- A ponte entre a web e a VM. A interface não tem pandas, nem yfinance, nem a
-- chave da Anthropic — e a VM não aceita conexão de fora. A web insere uma linha
-- aqui e o cron da VM executa. É o que permite "gerar briefing agora" pelo
-- navegador sem abrir uma única porta.
create table public.jobs (
  id        bigserial primary key,
  tipo      text not null check (tipo in ('briefing', 'snapshot', 'validar_tickers')),
  estado    text not null default 'pendente'
            check (estado in ('pendente', 'rodando', 'feito', 'erro')),
  pedido    jsonb not null default '{}',
  resultado jsonb,
  criado    timestamptz not null default now(),
  fechado   timestamptz
);
create index jobs_fila_idx on public.jobs (estado, criado);

-- ===================== o replay =====================
create function public.recomputar_posicoes()
returns void
language plpgsql
set search_path = ''
as $$
declare
  t        record;
  m        record;
  shares   numeric(18, 8);
  custo    numeric(18, 2);
  pnl      numeric(18, 2);
  removido numeric(18, 2);
begin
  delete from public.posicoes;

  for t in select distinct ticker from public.movimentacoes loop
    shares := 0; custo := 0; pnl := 0;

    for m in
      select * from public.movimentacoes where ticker = t.ticker order by data, id
    loop
      if m.tipo = 'compra' then
        shares := shares + m.shares;
        custo  := custo + m.shares * m.preco + m.taxas;

      elsif m.tipo = 'venda' then
        if m.shares > shares then
          raise exception
            'venda de % cotas de % excede a posição de % cotas na data %',
            m.shares, m.ticker, shares, m.data
            using errcode = 'check_violation';
        end if;
        -- Baixa do custo proporcional à fatia vendida: é o mesmo que
        -- cotas_vendidas x preço_médio, e não deixa resíduo de arredondamento.
        removido := case when shares > 0 then custo * (m.shares / shares) else 0 end;
        pnl      := pnl + (m.shares * m.preco - m.taxas - removido);
        custo    := custo - removido;
        shares   := shares - m.shares;

      elsif m.tipo = 'ajuste' then
        -- Correção manual: sobrescreve a posição em vez de somar. Serve para
        -- importar uma posição antiga sem inventar o histórico que a formou.
        shares := m.shares;
        custo  := m.shares * m.preco + m.taxas;
      end if;
    end loop;

    if shares > 0 then
      insert into public.posicoes (ticker, shares, avg_price, custo_total, pnl_realizado)
      values (t.ticker, shares, round(custo / shares, 6), round(custo, 2), round(pnl, 2));
    elsif pnl <> 0 then
      insert into public.posicoes (ticker, shares, avg_price, custo_total, pnl_realizado)
      values (t.ticker, 0, null, 0, round(pnl, 2));
    end if;
  end loop;
end $$;

comment on function public.recomputar_posicoes() is
  'Reconstrói posicoes inteira a partir do ledger. A regra "não vender o que não se tem" mora aqui.';

create function public.trg_recomputar_posicoes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.recomputar_posicoes();
  return null;
end $$;

revoke execute on function public.trg_recomputar_posicoes() from public, anon, authenticated;

-- `for each statement`: recomputa uma vez por comando, não uma vez por linha —
-- inserir 20 movimentações de uma vez faz um replay, não vinte.
create trigger movimentacoes_recomputa
after insert or update or delete on public.movimentacoes
for each statement execute function public.trg_recomputar_posicoes();

-- ===================== RLS =====================
-- Sem user_id: o sistema é de uma pessoa, identificada pelo primeiro cadastro.
-- Mas o RLS fica LIGADO: sem ele, a chave publicável que o PWA entrega ao
-- navegador exporia estas tabelas pelo PostgREST a qualquer um.
-- O Python da VM conecta como `postgres` e não passa por aqui.
do $$
declare
  tabela text;
begin
  foreach tabela in array array['ativos', 'movimentacoes', 'posicoes', 'perfil_investidor', 'snapshots', 'jobs'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('create policy "Dono do sistema" on public.%I for all to authenticated using ((select auth.uid()) = (select public.meu_usuario())) with check ((select auth.uid()) = (select public.meu_usuario()))', tabela);
  end loop;
end $$;
