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
  lib/supabase.ts   cliente Supabase
  layouts/          AppLayout (container + navegação inferior)
  components/       BottomNav
  pages/            uma pasta por área do app
    login/          tela de login
    cadastro/       criar conta
    dashboard/      visão do mês (protegida: exige login)
  hooks/            useAuth, useLancamentos... (a fazer)
  services/         funções que falam com o Supabase (a fazer)
  types/            tipos do banco (a fazer)
supabase/
  migrations/       SQL das tabelas (próxima etapa)
  functions/        Edge Functions da Pluggy (Open Finance)
```

## Próximas etapas

1. Migrations: contas, cartões, categorias, bancos e lançamentos (com RLS por usuário)
2. Autenticação (`useAuth`) e proteção das rotas
3. Telas de lançamento, extrato e relatório
4. Integração Open Finance via Pluggy (Edge Functions)
