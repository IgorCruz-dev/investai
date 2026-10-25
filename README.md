# Meu Bolso

App de controle financeiro pessoal (PWA): React + Vite + TypeScript + Tailwind, com Supabase no backend e deploy na Vercel.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha com a URL e a chave pública do Supabase
npm run dev
```

## Scripts

- `npm run dev`: servidor de desenvolvimento
- `npm run build`: checagem de tipos + build de produção em `dist/`
- `npm run preview`: serve o build localmente

## Estrutura

```
src/
  main.tsx          ponto de entrada (React + Router)
  App.tsx           rotas
  index.css         Tailwind + cores do app
  lib/              supabase.ts (cliente tipado), formatar.ts, datas.ts
  contexts/         AuthProvider (sessão compartilhada)
  layouts/          AuthLayout (login/cadastro), AppLayout (telas logadas + BottomNav)
  components/       Campo, Botao, Alerta, Card, Modal, SeletorMes, BottomNav, ícones...
  pages/            uma pasta por página
    login/, cadastro/
    dashboard/      aba "Início": saldo, gráfico, principais categorias, últimos lançamentos
    lancamentos/    todos os lançamentos do mês (/lancamentos?mes=2026-10&categoria=...)
    cartoes/        lista de cartões com limite usado
    detalhe-cartao/ fatura do cartão (/cartoes/:id?fatura=2026-11)
    assinaturas/, comparativo/, caixinha/
    bancos/         Open Finance: conexões, vínculo de contas/cartões e categorias do banco
  hooks/            useAuth
  services/         funções que falam com o Supabase
  types/            database.ts (gerado do banco), financas.ts
supabase/
  migrations/       SQL aplicado no banco (nome = versão registrada no Supabase)
  functions/        sync-pluggy: importa contas, cartões e transações do Meu Pluggy
```

Depois de cada migration, gere de novo `src/types/database.ts` a partir do banco.

## Open Finance (Meu Pluggy)

Uso pessoal, somente leitura. A Edge Function `sync-pluggy` precisa destes secrets no Supabase
(Edge Functions › Secrets); eles nunca vão para o front:

- `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`: da aplicação em dashboard.pluggy.ai
- `PLUGGY_ITEM_IDS`: ids das conexões do meu.pluggy.ai, separados por vírgula
- `PLUGGY_USER_ID`: id do seu usuário no app (só ele pode sincronizar)

Se reconectar um banco no meu.pluggy.ai, o id da conexão pode mudar: atualize `PLUGGY_ITEM_IDS`.
