# Specs

Este projeto é desenvolvido por spec: **nada entra no código sem estar escrito aqui
primeiro**. Não é burocracia — é a única forma de uma pessoa sozinha, voltando ao
projeto depois de semanas, não refazer uma decisão que já tomou com mais contexto
do que tem agora.

## O fluxo

```
spec.md    o QUE o sistema faz, e o que ele deliberadamente não faz.
           Escrito em termos de produto: comportamento observável, regras,
           casos de borda. Sem nome de arquivo, sem nome de função.

plan.md    COMO. Aqui entram arquivos, tabelas, assinaturas, ordem das fases.
           Uma spec pode ter mais de um plano ao longo da vida (reescritas).

tasks.md   as caixinhas. Marcadas conforme andam. É o que responde
           "onde eu estava?" em dez segundos.
```

## As regras

1. **Mudança de comportamento começa na `spec.md`.** Se o código faz algo que a
   spec não descreve, um dos dois está errado — e normalmente é o código.
2. **Uma pasta por funcionalidade**, numerada na ordem em que nasceu. O número
   não é prioridade, é só identidade estável para referência cruzada.
3. **Decisão com alternativa descartada escreve a alternativa.** Saber o que foi
   rejeitado e por quê vale mais que saber o que foi escolhido.
4. **Invariante atravessa specs.** Registre uma regra compartilhada na spec de
   unificação e aponte para ela nas funcionalidades afetadas.

## As specs

| # | Funcionalidade | Estado |
|---|---|---|
| [001](001-unificacao/spec.md) | Unificação: InvestAI vira controle financeiro completo ([repasse atual](001-unificacao/handoff.md)) | concluída |
| [002](002-onboarding/spec.md) | Onboarding: perfil, carteira existente e primeira carteira | implementado (diagnóstico 3c parcial) |
| [003](003-recomendacao/spec.md) | Recomendação de carteira por cálculo, com veto por notícia | implementada |
| [004](004-aporte-e-despesa/spec.md) | A costura: comprar ação é uma despesa | implementada |
