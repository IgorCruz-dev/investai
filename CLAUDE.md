# Regra de custo da IA

No código Python, somente briefing, análise de ativo e `/pergunta` podem chamar a API da Anthropic. A fixture `ambiente` em `tests/test_server.py` falha se uma função paga for chamada por outro caminho durante os testes.

No Supabase Edge Functions, as exceções nomeadas são `noticias-sync`, `radar-sync` e `mercado-sync`. Nesta versão, apenas as duas primeiras chamam a Anthropic; `mercado-sync` coleta dados públicos sem IA. Qualquer chamada futura desses três caminhos deve passar por `supabase/functions/_shared/ia.ts`, sem outra porta paga.

A porta comum usa `IA_LIMITE_MENSAL_USD` (padrão US$ 2), consulta `ia_uso` antes de cada chamada e recusa a estimativa que ultrapassar o teto. Depois registra os tokens consumidos. Sem `ANTHROPIC_API_KEY` ou com o teto atingido, notícias continuam sem classificação e o radar conserva os sinais quantitativos; a tela segue disponível. O limite de gastos do workspace da chave no Console é a proteção final contra chamadas simultâneas.

Não acrescente outros caminhos pagos sem mudar a spec e esta regra.
