# Desenho do sistema

```text
PWA (Vercel) ── Supabase Auth + PostgREST ── Postgres
                                          │
VM: Python + Baileys ────────────────────┘
```

O PWA usa a chave publicável e RLS. A VM usa `DATABASE_URL` para acessar o mesmo
banco, sem expor a connection string no navegador. A VM busca preços e notícias,
grava snapshots e atende o WhatsApp. A interface solicita trabalho à VM inserindo
um `job`; `scripts/process_jobs.py` o consome por cron. A VM não precisa abrir
uma rota pública para a interface.

As tabelas financeiras vieram do Money. As tabelas `ativos`, `movimentacoes`,
`posicoes`, `perfil_investidor`, `snapshots` e `jobs` pertencem aos investimentos.
`movimentacoes` é o ledger; o banco recompõe `posicoes` após cada mudança.
Outro gatilho espelha compras e vendas declaradas em `transacoes`. Uma posição
importada no onboarding não gera despesa retroativa.

O primeiro cadastro no Supabase Auth é o dono da instalação, fixado na tabela
`instalacao`. RLS limita as tabelas de investimento a essa conta, e a FK
impede apagar a conta enquanto ela possui a carteira. O WhatsApp usa a lista em
`WHATSAPP_ALLOWED_NUMBERS`; o serviço é pessoal e não tem registro de tenants.

As decisões de produto ficam em [specs](../specs/README.md). A
[spec 001](../specs/001-unificacao/spec.md) explica a unificação e a
[spec 004](../specs/004-aporte-e-despesa/spec.md) explica a costura financeira.
