# InvestAI

Controle financeiro pessoal com investimentos, PWA e assistente no WhatsApp.
Uma instalação usa um projeto Supabase e uma VM para os cálculos de mercado e
o bot. O PWA lê os mesmos lançamentos e posições que a VM.

## Estrutura

| Pasta | Função |
|---|---|
| `apps/pwa` | Interface React: contas, cartões, lançamentos e investimentos |
| `apps/bridge` | Ponte Baileys para o WhatsApp |
| `src/investai` | Assistente, análise quantitativa, acesso ao banco e snapshots |
| `supabase/migrations` | Schema financeiro, investimentos e gatilho da costura |
| `supabase/functions` | Sincronização Open Finance |
| `specs` | Regras de produto, decisões e andamento |

## Primeiro acesso

1. Crie um projeto Supabase e copie a URI de **Session pooler** em Project
   Settings → Database → Connection string. Substitua `[YOUR-PASSWORD]` pela
   senha **do banco**. Salve como `DATABASE_URL` no `.env` da raiz. O arquivo é
   ignorado pelo Git; não coloque a URI no PWA.
2. Instale as dependências Python: `python -m venv .venv` e
   `.venv/bin/pip install -e .`.
3. Confira e aplique as migrações:

   ```bash
   .venv/bin/python scripts/aplicar_supabase.py --conferir
   .venv/bin/python scripts/aplicar_supabase.py
   ```

4. Em `apps/pwa`, crie `.env.local` com `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_PUBLISHABLE_KEY` do mesmo projeto. Execute `npm install` e
   `npm run dev`. Cadastre a primeira conta no PWA: ela será a dona da carteira
   de investimentos.
5. Na VM, configure `ANTHROPIC_API_KEY`, `BRIDGE_SECRET`,
   `WHATSAPP_ALLOWED_NUMBERS` e `INVESTAI_CRON_TOKEN` no `.env`. O bot só atende
   os números permitidos. Os cálculos periódicos usam
   `scripts/publish_snapshot.py` e os pedidos do PWA usam
   `scripts/process_jobs.py` — que precisa estar no cron para o onboarding
   funcionar, porque é ele que calcula a carteira sugerida.

## Começando sem carteira

O sistema serve tanto para quem já tem ações como, principalmente, para quem
ainda não tem. Com a carteira vazia, a aba Investimentos oferece dois caminhos:

- **Responder o perfil**: 18 perguntas em quatro blocos. Ao concluir, o PWA
  grava as respostas e enfileira um job; a VM deriva o perfil (score, perfil de
  risco, alocação-alvo, pré-requisitos) e publica uma **carteira sugerida** com
  o peso de cada ativo justificado em número, os rejeitados com o critério que
  cada um não cumpriu, e os vetados por notícia grave com a frase e a fonte.
  Aceitar a sugestão **não compra nada**: a posição nasce quando você declara a
  compra depois de executá-la na corretora.
- **Importar o que já tem**: uma linha por ativo, `ticker quantidade`. O preço
  médio é opcional quando há cotação conhecida. Essas posições não geram despesa
  retroativa no seu mês.

Enquanto a VM calcula, a tela se atualiza sozinha. Nada da carteira sai de um
modelo de linguagem: seleção, nota, peso e cota são aritmética
([spec 003](specs/003-recomendacao/spec.md)).

Veja [o PWA](apps/pwa/README.md) para a interface e [as specs](specs/README.md)
para o comportamento detalhado: nada entra no código sem estar escrito lá
primeiro. [O repasse](specs/handoff.md) diz onde o trabalho parou e o que está
bloqueado.

## Modelo de dados

`movimentacoes` registra compra e venda; um gatilho recompõe `posicoes` e cria
uma `transacoes` correspondente. Compra vira despesa, venda vira receita.
Posições importadas no onboarding não geram despesa antiga. O PWA lê o último
snapshot da VM para mostrar cotação e valor de mercado; sem snapshot, mostra o
custo registrado, com rótulo explícito. A [spec 004](specs/004-aporte-e-despesa/spec.md)
descreve os casos de borda.

## Verificação local

```bash
.venv/bin/ruff check src scripts tests
.venv/bin/pytest -q -m 'not network'
cd apps/pwa && npm run build
```

Os scripts `scripts/verificar_costura.py` e `scripts/verificar_rls.py` testam no
Postgres real e revertem a transação ao final. O primeiro cobre compra, edição,
exclusão e onboarding como `postgres`; o segundo cobre o isolamento entre contas
e o caminho de escrita do PWA como `authenticated`, que tem outros grants.

Depois de mexer nas perguntas do questionário, reexporte o JSON que o PWA lê:

```bash
.venv/bin/python scripts/exportar_perguntas.py
```
