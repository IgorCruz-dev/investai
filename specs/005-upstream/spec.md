# Atualização do PWA a partir do Money

O InvestAI incorpora as funcionalidades novas do Money no controle financeiro, mantendo a identidade visual do InvestAI. O tema escuro é o padrão; o usuário pode escolher o claro e a escolha persiste.

A aba Investimentos apresenta duas origens identificadas: dados bancários da Pluggy, somente leitura, e a carteira de bolsa declarada pelo usuário, com movimentações, posições e resultado realizado. As duas fontes não se misturam.

Os lançamentos de investimento declarados continuam vinculados à movimentação no banco. As categorias Investimento e Outros mantêm suas cores próprias.

Notícias, radar e mercado podem chamar IA apenas pelos três caminhos nomeados, com limite mensal conferido antes de cada chamada. Sem chave da Anthropic, o conteúdo dependente de IA pode faltar sem impedir o uso do restante da tela.

As migrações do Money precedem as migrações locais de carteira no histórico versionado. Em produção, a carteira local já havia sido criada antes desta atualização; seus seis registros de histórico são renumerados sem executar o SQL novamente. A cor de “Outros” em cadastros existentes é corrigida por uma migração própria.

## Alternativas descartadas

- Mesclar os dois modelos de investimentos em uma tabela: banco reportado e livro-caixa declarado têm origem e semântica diferentes.
- Usar o tema claro como padrão: a identidade atual do InvestAI foi construída sobre a paleta escura.
- Resolver o restyle arquivo a arquivo: o mapeamento de classes reproduz a identidade existente de forma consistente.
