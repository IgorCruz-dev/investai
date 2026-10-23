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
  hooks/            useAuth
  services/         funções que falam com o Supabase
  types/            database.ts (gerado do banco), financas.ts
supabase/
  migrations/       SQL aplicado no banco (nome = versão registrada no Supabase)
  functions/        Edge Functions da Pluggy (Open Finance)
```

Depois de cada migration, gere de novo `src/types/database.ts` a partir do banco.
