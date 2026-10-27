# Andamento

- [x] Importar o Money em `apps/pwa` e mover `supabase/` para a raiz.
- [x] Escrever as migrações de investimentos, costura e proteção do lançamento.
- [x] Aplicar as 17 migrações ao Supabase novo; verificar cadastro único,
      compra, edição, exclusão e onboarding em transação revertida.
- [x] Confirmar a primeira conta real: um usuário, um dono fixo, perfil e
      categorias iniciais; testar RLS para dono, outra conta e visitante.
- [x] Remover a camada multiusuário, o registro central e `apps/web`.
- [x] Reestilizar o PWA e inspecionar o login no Chrome local, em celular e desktop.
- [x] Concluir a aba Investimentos (posições, extrato, compra/venda, snapshot,
      job de atualização e comparação de alocação em bolsa implementados; fluxo
      do job e publicação do snapshot conferidos; o caminho de escrita da aba
      provado como `authenticated`, inclusive a recusa de venda acima da
      posição; a consulta do job filtra `tipo = 'snapshot'`; tela autenticada
      inspecionada e aprovada pelo usuário em 27/10/2026).
- [x] Atualizar documentação de setup e deploy.
- [x] Executar validação final do sistema unificado (ruff, `git diff --check`,
      `npm run build` com type-check, 520 testes pytest e os dois validadores de
      banco passaram; `aplicar_supabase.py --conferir` aponta 0 pendências;
      sessão real do PWA exercitada pelo usuário).

A spec 001 está concluída. O que o usuário sentiu falta na aba — responder as
18 perguntas e receber uma carteira sugerida — é escopo das specs 002 e 003,
que têm motor em Python e **nenhuma tela no PWA**. Veja o fim do handoff.

Estado detalhado e próximos passos: [handoff.md](handoff.md).
