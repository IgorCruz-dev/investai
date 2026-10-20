-- InvestAI — esquema inicial do Postgres (Neon).
--
-- Aplicar com:  psql "$DATABASE_URL" -f deploy/sql/001_initial.sql
-- É idempotente: rodar duas vezes não quebra nem apaga dado.
--
-- A ideia central do esquema: `movimentacoes` é a verdade e `posicoes` é
-- derivada dela por replay. Não existe caminho em que as duas divirjam, porque
-- ninguém escreve em `posicoes` à mão — só o trigger escreve.

begin;

-- Catálogo de ativos. Semeado de src/investai/analysis/screener.py (UNIVERSE, 38 ativos);
-- um ticker novo entra com validado=false e o cron da VM confere no yfinance.
-- Só a VM pode validar (é yfinance), então a web grava otimista e espera.
create table if not exists ativos (
  ticker     text primary key,
  nome       text,
  classe     text not null default 'acao'
             check (classe in ('acao', 'etf', 'fii', 'renda_fixa')),
  setor      text,
  validado   boolean not null default false,  -- existe no yfinance?
  invalido   boolean not null default false,  -- conferido e NÃO existe
  conferido  timestamptz
);

-- O ledger. Append-only no espírito, mas editável e removível de propósito:
-- corrigir um preço digitado errado três meses atrás é um caso real, e o replay
-- recompõe a posição sozinho.
create table if not exists movimentacoes (
  id      bigserial primary key,
  tipo    text   not null check (tipo in ('compra', 'venda', 'ajuste')),
  ticker  text   not null references ativos(ticker),
  shares  numeric(18, 8) not null check (shares > 0),
  preco   numeric(18, 6) not null check (preco >= 0),
  taxas   numeric(18, 6) not null default 0 check (taxas >= 0),
  data    date   not null default current_date,
  origem  text   not null check (origem in ('web', 'whatsapp', 'migracao')),
  nota    text,
  criado  timestamptz not null default now()
);

-- (ticker, data, id) é a ordem do replay; (data desc, id desc) é a do extrato.
create index if not exists idx_mov_replay  on movimentacoes (ticker, data, id);
create index if not exists idx_mov_extrato on movimentacoes (data desc, id desc);

-- Materialização do replay. `shares = 0` com pnl_realizado != 0 é uma posição
-- encerrada: a linha fica para o resultado não se perder, e quem lê a carteira
-- filtra por shares > 0.
create table if not exists posicoes (
  ticker        text primary key references ativos(ticker),
  shares        numeric(18, 8) not null check (shares >= 0),
  avg_price     numeric(18, 6),                      -- null quando shares = 0
  custo_total   numeric(18, 2) not null default 0,
  pnl_realizado numeric(18, 2) not null default 0,
  atualizado    timestamptz not null default now()
);

-- Perfil do investidor: uma linha, sempre id = 1.
create table if not exists perfil (
  id         int primary key default 1 check (id = 1),
  respostas  jsonb not null,   -- as 18 respostas do questionário
  derivado   jsonb not null,   -- build_profile(): score, alocação, pré-requisitos
  atualizado timestamptz not null default now()
);

-- Snapshot publicado pela VM: preços, indicadores, notícias e briefing já
-- calculados. A web lê o último e não calcula indicador nenhum.
create table if not exists snapshots (
  id        bigserial primary key,
  gerado_em timestamptz not null default now(),
  payload   jsonb not null
);
create index if not exists idx_snapshots_recente on snapshots (gerado_em desc);

-- Fila de trabalho: a web pede, a VM executa no próximo cron. É o que permite
-- "gerar briefing agora" pelo navegador sem a VM abrir porta nenhuma.
create table if not exists jobs (
  id        bigserial primary key,
  tipo      text not null check (tipo in ('briefing', 'snapshot', 'validar_tickers')),
  estado    text not null default 'pendente'
            check (estado in ('pendente', 'rodando', 'feito', 'erro')),
  pedido    jsonb not null default '{}',
  resultado jsonb,
  criado    timestamptz not null default now(),
  fechado   timestamptz
);
create index if not exists idx_jobs_fila on jobs (estado, criado);

-- Tentativas de login da interface web. Senha única exposta na internet sem
-- registro de tentativa é só questão de tempo de CPU de alguém.
create table if not exists tentativas_login (
  id      bigserial primary key,
  ip      text,
  sucesso boolean not null,
  criado  timestamptz not null default now()
);
create index if not exists idx_login_janela on tentativas_login (criado desc);


-- ---------------------------------------------------------------------------
-- O replay: de `movimentacoes` para `posicoes`.
-- ---------------------------------------------------------------------------
-- Preço médio ponderado com as taxas dentro do custo — que é também o critério
-- da Receita para apurar ganho de capital, então o pnl_realizado serve para o
-- imposto, não só para a tela.
--
-- Recomputa tudo a cada escrita, em vez de aplicar delta incremental. Para um
-- ledger pessoal (centenas de linhas ao longo de anos) isso custa microssegundos,
-- e elimina a classe de bug em que um delta errado deixa a posição torta para
-- sempre sem ninguém notar.
create or replace function recomputar_posicoes() returns void
language plpgsql as $$
declare
  t        record;
  m        record;
  shares   numeric(18, 8);
  custo    numeric(18, 2);
  pnl      numeric(18, 2);
  removido numeric(18, 2);
begin
  delete from posicoes;

  for t in select distinct ticker from movimentacoes loop
    shares := 0; custo := 0; pnl := 0;

    for m in
      select * from movimentacoes where ticker = t.ticker order by data, id
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
        -- cotas_vendidas × preço_médio, e não deixa resíduo de arredondamento.
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
      insert into posicoes (ticker, shares, avg_price, custo_total, pnl_realizado)
      values (t.ticker, shares, round(custo / shares, 6), round(custo, 2), round(pnl, 2));
    elsif pnl <> 0 then
      insert into posicoes (ticker, shares, avg_price, custo_total, pnl_realizado)
      values (t.ticker, 0, null, 0, round(pnl, 2));
    end if;
  end loop;
end $$;

create or replace function trg_recomputar_posicoes() returns trigger
language plpgsql as $$
begin
  perform recomputar_posicoes();
  return null;
end $$;

drop trigger if exists movimentacoes_recomputa on movimentacoes;

-- `for each statement`: recomputa uma vez por comando, não uma vez por linha —
-- inserir 20 movimentações de uma vez faz um replay, não vinte.
create trigger movimentacoes_recomputa
after insert or update or delete on movimentacoes
for each statement execute function trg_recomputar_posicoes();

commit;
