# Publicação do InvestAI

O PWA fica na Vercel, com Supabase Auth e Postgres. A VM executa o bot, a ponte
Baileys, os jobs e os snapshots. Nenhuma chave de serviço do Supabase ou URI de
Postgres entra no build do PWA.

## Supabase

1. Crie um projeto novo. Em Project Settings → Database → Connection string,
   copie a URI de **Session pooler**. Substitua `[YOUR-PASSWORD]` pela senha do
   banco. Ponha a URI em `DATABASE_URL` no `.env` da raiz.
2. Confira e aplique `supabase/migrations` em ordem:

   ```bash
   .venv/bin/python scripts/aplicar_supabase.py --conferir
   .venv/bin/python scripts/aplicar_supabase.py
   ```

   O script recusa host fora do Supabase e um schema financeiro já criado sem
   histórico de migração. Registra o hash de cada arquivo aplicado; mudanças
   posteriores devem ir em uma migração nova.
3. Cadastre a primeira conta pelo PWA. Ela é a dona das tabelas de investimento
   pela política RLS. Configure o Open Finance seguindo
   [as instruções do PWA](../apps/pwa/README.md), se for usá-lo.

## PWA

Em `apps/pwa/.env.local` ou nas variáveis da Vercel, defina
`VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. São credenciais públicas;
o RLS protege os dados. Execute `npm run build` em `apps/pwa` antes de publicar.
O diretório de saída é `dist/`.

## VM

No `.env` da VM, configure `DATABASE_URL` para o **mesmo** Supabase,
`ANTHROPIC_API_KEY`, `BRIDGE_SECRET`, `WHATSAPP_ALLOWED_NUMBERS` e
`INVESTAI_CRON_TOKEN`. A ponte usa o mesmo `BRIDGE_SECRET` em `apps/bridge/.env`.
O bot atende apenas números da lista, com DDI e DDD, separados por vírgula.

Os serviços existentes em `deploy/` iniciam o Python e a ponte. O crontab
`deploy/crontab.example` publica snapshots e processa jobs. Para atualizar uma
VM configurada, use `deploy/update-vm.sh` após revisar o destino `VM`.

A fila de jobs roda **a cada minuto**, e não a cada cinco: ela virou o caminho
do onboarding. Quem responde as 18 perguntas fica olhando a tela esperando a
carteira, e cinco minutos de espera ali é abandono.

### O job de recomendação

O PWA grava as respostas e enfileira `recomendacao`;
`scripts/publish_recomendacao.py` deriva o perfil, roda o filtro quantitativo e
publica o plano. Para rodar à mão:

```bash
.venv/bin/python scripts/publish_recomendacao.py              # com triagem de notícia
.venv/bin/python scripts/publish_recomendacao.py --sem-triagem  # custo zero
```

A **triagem de notícia** é o único caminho pago fora de briefing, análise de
ativo e `/pergunta`: o modelo pode apenas *tirar* um ativo aprovado por notícia
grave, com o motivo gravado, e nunca mexe em nota, peso ou cota
([spec 003](../specs/003-recomendacao/spec.md)). Sem `ANTHROPIC_API_KEY`, sem
notícia na janela ou com a API fora, o plano sai igual e marcado *sem triagem*.
Use `--sem-triagem` para rodar o fluxo inteiro sem gastar crédito.

### Se as perguntas do questionário mudarem

O PWA desenha as 18 perguntas a partir de `apps/pwa/src/data/perguntas.json`.
Depois de mexer em `src/investai/onboarding/questionnaire.py`, reexporte:

```bash
.venv/bin/python scripts/exportar_perguntas.py
```

`tests/test_onboarding_export.py` quebra se esquecer.

## Conferência

```bash
.venv/bin/python scripts/aplicar_supabase.py --conferir
.venv/bin/python scripts/verificar_costura.py
.venv/bin/python scripts/verificar_rls.py
.venv/bin/ruff check src scripts tests
.venv/bin/pytest -q -m 'not network'
cd apps/pwa && npm run build
```

`verificar_costura.py` e `verificar_rls.py` criam dados de teste dentro de uma
transação e fazem rollback: o projeto não fica com compras fictícias.
`verificar_costura.py` roda como `postgres`; `verificar_rls.py` também exercita
o caminho de escrita da aba como `authenticated`, que é o do PWA e tem outros
grants.
