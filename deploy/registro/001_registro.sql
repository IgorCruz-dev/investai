-- InvestAI — esquema do BANCO DE REGISTRO (central).
--
-- Atenção: este banco é OUTRO, separado dos bancos de carteira. Ele guarda
-- apenas quem usa a instância compartilhada e as credenciais de cada pessoa —
-- nenhuma posição, nenhuma movimentação.
--
--   .venv/bin/python scripts/migrar.py --registro
--
-- Por que o registro vive num banco e não num arquivo na VM: a VM não escuta
-- nada na internet (nenhuma porta, nenhum túnel), então ninguém consegue
-- "subir" credencial para ela. Um banco é alcançável de qualquer lugar, e a VM
-- e a Vercel leem dele fazendo só conexão de SAÍDA — a mesma propriedade que o
-- resto do deploy preserva.

begin;

create table if not exists tenants (
  -- O id viaja dentro do cookie de sessão da web (`usuario.prazo.assinatura`):
  -- um ponto aqui quebraria a leitura da assinatura. A mesma regra está em
  -- src/investai/tenants.py e em apps/web/api/_tenants.js — aqui ela é a
  -- última palavra, porque nem um `insert` na mão passa por cima.
  id        text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  nome      text not null check (length(trim(nome)) > 0),

  -- Único: dois cadastros no mesmo telefone rotearia a mensagem de uma pessoa
  -- para o banco da outra.
  telefone  text not null unique check (telefone ~ '^[0-9]{10,15}$'),

  -- Credenciais da pessoa. `database_url` é o endpoint DIRETO (psycopg da VM) e
  -- `database_url_pooled` o com pooler (funções serverless da Vercel).
  database_url        text not null check (database_url like 'postgres%'),
  database_url_pooled text not null check (database_url_pooled like 'postgres%'),

  -- Obrigatória: cada pessoa traz a própria chave e paga a própria conta. Sem
  -- isso o uso de uma sairia do crédito de quem hospeda, e o gasto de uma
  -- bloquearia a IA das outras.
  anthropic_key       text not null check (length(anthropic_key) > 10),

  -- Hash PBKDF2-SHA256 (210 mil iterações). A senha em si não existe em lugar
  -- nenhum — nem aqui, nem no repositório, nem na Vercel.
  web_password_hash   text not null check (web_password_hash like 'pbkdf2$%'),

  budget_usd  numeric(10, 2) not null default 5 check (budget_usd >= 0),

  -- Desligar sem apagar: tira o acesso preservando o histórico de quem entrou.
  ativo       boolean not null default true,

  criado      timestamptz not null default now(),
  atualizado  timestamptz not null default now()
);

create or replace function tocar_atualizado() returns trigger as $$
begin
  new.atualizado = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tenants_atualizado on tenants;
create trigger tenants_atualizado before update on tenants
  for each row execute function tocar_atualizado();

-- Role de inscrição: escreve a própria linha, NÃO LÊ nenhuma.
--
-- É a credencial que cada pessoa recebe uma vez para rodar o wizard. Sem
-- `select`, quem tem essa string não consegue ler a chave de API nem o banco de
-- ninguém — só gravar a própria linha. Crie a role antes de aplicar isto:
--
--   create role investai_inscricao login password 'escolha-uma-longa';
--
-- (Se a role não existir, os grants abaixo são apenas ignorados com aviso.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'investai_inscricao') then
    grant usage on schema public to investai_inscricao;
    grant insert, update on tenants to investai_inscricao;
    raise notice 'grants de inscrição aplicados (insert/update, sem select)';
  else
    raise notice 'role investai_inscricao não existe — grants não aplicados';
  end if;
end;
$$;

commit;
