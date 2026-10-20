"""Resolução determinística de intenção: o que o usuário quis, sem perguntar ao LLM.

Motivo de existir: até aqui **toda** mensagem passava pelo agente com as 8
definições de ferramenta no prompt. A primeira de cada conversa escreve ~4 mil
tokens de cache a 125% do preço de entrada — ~US$ 0,030 para responder "como
está minha carteira?", cuja resposta é uma consulta e três linhas de formatação.

A regra que este módulo implementa:

- **sem LLM** (resposta montada em código, custo zero): carteira, cotação,
  perfil, alocação, sugestão, notícias, extrato, registro de compra e venda,
  onboarding, status, ajuda;
- **com LLM**: só `/briefing`, `/analise <ativo>` e `/pergunta <texto>`.

Desenho: `resolver()` é **puro** — olha o texto e a sessão e devolve a intenção,
sem tocar em rede, banco ou modelo. Quem faz o trabalho é `Intencao.executar()`.
Essa separação é o que permite testar a tabela de roteamento inteira offline e
afirmar, de verdade, que nenhuma rota barata chama o modelo.

A ordem de resolução importa:

1. **sessão pendente** — "sim" e "3" só significam algo dentro de um contexto;
2. **comando explícito** (`/carteira`);
3. **palavra-chave + ticker** ("quanto está a petr4");
4. **número solto** respondendo ao último menu;
5. **menu** — nunca o modelo.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from investai.utils import tickers

logger = logging.getLogger(__name__)


# --- Normalização -----------------------------------------------------------
def normalizar_texto(texto: str) -> str:
    """Minúsculas, sem acento, sem pontuação de borda, espaços colapsados.

    "Qual é a COTAÇÃO da PETR4??" → "qual e a cotacao da petr4"

    Sem acento porque ninguém acentua direito no celular, e um roteador que só
    entende "cotação" mas não "cotacao" parece quebrado.

    Vírgula e ponto são preservados **no meio** do texto e removidos só nas
    bordas. Apagá-los em todo lugar quebraria exatamente o que esta função
    precisa preservar: `"comprei 100 PETR4 a 35,50"` viraria `"... a 35 50"` e o
    preço chegaria como 35 — um erro de duas ordens de grandeza na carteira.
    """
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", texto or "")
        if unicodedata.category(c) != "Mn"
    )
    limpo = re.sub(r"[?!;:]+", " ", sem_acento.lower())
    limpo = re.sub(r"\s+", " ", limpo).strip()
    return limpo.strip(" .,")


# --- Intenção ---------------------------------------------------------------
@dataclass
class Intencao:
    """O que fazer com a mensagem. `executar` só é chamado pelo servidor."""

    nome: str
    #: True só nas três rotas que chamam a API da Anthropic.
    usa_llm: bool = False
    args: dict[str, Any] = field(default_factory=dict)
    #: Mensagem enviada ANTES de executar, quando a execução demora.
    aviso: str = ""
    #: Resposta já pronta — usado pelas intenções que não precisam de I/O.
    texto: str = ""

    def __repr__(self) -> str:  # facilita a leitura quando um teste falha
        return f"Intencao({self.nome}{'+llm' if self.usa_llm else ''}, {self.args})"


def _i(nome: str, **args: Any) -> Intencao:
    return Intencao(nome=nome, args=args)


def _llm(nome: str, aviso: str = "", **args: Any) -> Intencao:
    return Intencao(nome=nome, usa_llm=True, aviso=aviso, args=args)


# --- Menu -------------------------------------------------------------------
#: O fallback de linguagem natural. Dez itens, respondíveis por número — é o que
#: mantém a conversa agradável sem cair no modelo a cada frase não prevista.
MENU: tuple[tuple[str, str, str], ...] = (
    ("1", "Carteira", "carteira"),
    ("2", "Cotação de um ativo", "pedir_cotacao"),
    ("3", "Análise de um ativo (usa IA)", "pedir_analise"),
    ("4", "Notícias", "noticias"),
    ("5", "Registrar compra ou venda", "ajuda_movimento"),
    ("6", "Extrato de movimentações", "extrato"),
    ("7", "Meu perfil e alocação-alvo", "perfil"),
    ("8", "O que eu deveria comprar", "sugestao"),
    ("9", "Briefing da semana (usa IA)", "briefing"),
    ("10", "Status do sistema", "status"),
)

POR_NUMERO = {numero: destino for numero, _rotulo, destino in MENU}


def texto_do_menu(cabecalho: str = "") -> str:
    linhas = [cabecalho] if cabecalho else []
    linhas.append("*O que você quer?* Responda com o número:")
    linhas += [f"{numero}. {rotulo}" for numero, rotulo, _ in MENU]
    linhas.append("")
    linhas.append("Ou escreva do seu jeito — \"comprei 100 PETR4 a 35,50\", "
                  "\"quanto está a VALE3\", \"analisa ITUB4\".")
    return "\n".join(linhas)


# --- Vocabulário ------------------------------------------------------------
# Cada entrada é (regex, construtor). A ordem é a precedência, e os casos
# específicos vêm antes dos genéricos — "o que eu deveria comprar" tem de ser
# testado antes de qualquer padrão que contenha "comprar".

SIM = re.compile(r"^(s|si|sim|isso|ok|okay|confirma|confirmar|confirmo|pode|"
                 r"pode ser|manda|certo|exato|positivo|claro|1|y|yes|👍|✅)$")
NAO = re.compile(r"^(n|nao|não|nops|cancela|cancelar|cancel|descarta|descartar|"
                 r"negativo|errado|esquece|2|no|❌)$")

#: `comprei 100 PETR4 a 35,50` e variações. Quantidade e ticker obrigatórios —
#: é o que separa "comprei 100 petr4" de "o que eu deveria comprar".
MOVIMENTO = re.compile(
    r"\b(?P<verbo>comprei|compra|comprar|comprado|adquiri|vendi|venda|vender|vendido)\b"
    r"[^0-9a-z]*"
    r"(?:(?P<qtd1>[\d.,]+)\s*(?:cotas?|acoes?|unidades?|un)?\s*(?:de\s+)?(?P<tic1>[a-z]{4}\d{1,2})"
    r"|(?P<tic2>[a-z]{4}\d{1,2})\s*(?:[,:]\s*)?(?P<qtd2>[\d.,]+))"
    r"(?:\s*(?:a|por|ao preco de|@|x)\s*(?:r\$\s*)?(?P<preco>[\d.,]+))?"
    r"(?:\s*(?:em|no dia|dia|data)\s*(?P<data>\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?))?"
)

#: `/ajustar PETR4 120 36,10` — posição importada, sem histórico que a formou.
AJUSTE = re.compile(
    r"^(?:/ajustar|/ajuste|/posicao|ajusta|ajustar|corrige|corrigir)\s+"
    r"(?P<tic>[a-z]{4}\d{1,2})\s+(?P<qtd>[\d.,]+)(?:\s+(?P<preco>[\d.,]+))?"
)

PADROES: tuple[tuple[re.Pattern[str], Callable[[re.Match[str], str], Intencao]], ...] = (
    # ---- ajuda e menu
    (re.compile(r"^(/ajuda|/help|/start|/menu|ajuda|menu|help|socorro|"
                r"o que (voce|vc) (faz|sabe fazer)|como funciona|opcoes|comandos)$"),
     lambda m, t: _i("ajuda")),

    # ---- limpar
    (re.compile(r"^(/limpar|/reset|limpar|esquece tudo|esquecer tudo|recomecar)$"),
     lambda m, t: _i("limpar")),

    # ---- as duas rotas de LLM, pedidas explicitamente
    (re.compile(r"^/briefing|^briefing|\bbriefing\b|"
                r"\b(analise|resumo|leitura) (da|desta|dessa) semana\b|"
                r"\b(analise|relatorio) (completa?o?|geral) da carteira\b"),
     lambda m, t: _i("confirmar_briefing")),

    (re.compile(r"^/analise\b|^/analisa\b|"
                r"\b(analisa|analise|analisar|avalia|avaliar|opina|opiniao sobre|"
                r"o que (voce|vc) (acha|pensa) (de|da|do|sobre)|vale (a pena )?comprar|"
                r"devo comprar|compro)\b"),
     lambda m, t: _analise(t)),

    (re.compile(r"^/pergunta\b|^/perguntar\b"),
     lambda m, t: _pergunta(t)),

    # ---- sugestão (ANTES de qualquer padrão com "comprar")
    (re.compile(r"^/sugestao|^/sugerir|"
                r"\bo que (eu )?(deveria|devo|poderia) (comprar|investir)\b|"
                r"\bmonta(r)? (uma )?carteira\b|\bcarteira (sugerida|recomendada|ideal)\b|"
                r"\b(sugestao|sugere|sugira|recomenda|recomende|recomendacao) (de )?"
                r"(carteira|ativos|investimento)\b|\bonde (eu )?invisto\b"),
     lambda m, t: _i("sugestao")),

    # ---- alocação (ANTES de "perfil", porque "alocação do meu perfil" é alocação)
    (re.compile(r"^/alocacao|"
                r"\baloca(cao|r)\b|\bquanto (em|devo ter em) cada (classe|ativo)\b|"
                r"\bo que (falta|me falta)\b|\breserva de emergencia\b|"
                r"\bpre-?requisito"),
     lambda m, t: _i("alocacao")),

    # ---- perfil
    (re.compile(r"^/perfil|"
                r"\b(meu|qual (e )?o meu) perfil\b|\bperfil de (investidor|risco)\b|"
                r"\bminha toleranc?ia (a|ao) risco\b|\bsou (conservador|moderado|arrojado)\b"),
     lambda m, t: _i("perfil")),

    # ---- onboarding
    (re.compile(r"^/onboarding|^/questionario|"
                r"\b(refazer|fazer|responder|comecar) (o )?(onboarding|questionario|perfil)\b|"
                r"\bquestionario\b|\bmudou minha situacao\b|\bquero (definir|descobrir) meu perfil\b"),
     lambda m, t: _i("onboarding")),

    # ---- escrita: ajuste explícito
    (AJUSTE, lambda m, t: _i("ajustar", ticker=tickers.normalizar(m.group("tic")),
                             shares=m.group("qtd"), preco=m.group("preco"))),

    # ---- escrita: remover
    (re.compile(r"^/remover\b|^/apagar\b|"
                r"\b(remove|remover|apaga|apagar|exclui|excluir|zera|zerar|tira|tirar)\b"
                r"(?=.*\b[a-z]{4}\d{1,2}\b)"),
     lambda m, t: _com_ticker(t, "remover",
                              "Qual ativo você quer remover da carteira? Ex: /remover PETR4")),

    # ---- escrita: desfazer
    (re.compile(r"^/desfazer$|^desfazer$|^desfaz$|\bapaga(r)? (a )?ultima\b|"
                r"\bdesfaz(er)? (o|a) ultim[oa]\b"),
     lambda m, t: _i("desfazer")),

    # ---- escrita: compra e venda
    (MOVIMENTO, lambda m, t: _movimento(m)),

    # ---- extrato
    (re.compile(r"^/extrato|^/historico|"
                r"\bextrato\b|\bmovimenta(cao|coes)\b|\bhistorico de (compra|venda|movimenta)|"
                r"\bminhas (compras|vendas)\b|\bo que eu (comprei|vendi)\b"),
     lambda m, t: _i("extrato", ticker=_primeiro_ticker(t))),

    # ---- notícias (ANTES de carteira: "o que saiu sobre meus ativos" tem
    #      "meus ativos" dentro, e é pedido de notícia, não de posição)
    (re.compile(r"^/noticias|^/news|"
                r"\bnoticias?\b|\bo que (saiu|aconteceu|rolou)\b|\bmanchetes?\b|"
                r"\bnovidades?\b|\bimprensa\b"),
     lambda m, t: _i("noticias", ticker=_primeiro_ticker(t))),

    # ---- carteira
    (re.compile(r"^/carteira|^/posicoes|"
                r"\b(minha|na minha|da minha) carteira\b|^carteira$|\bposicoes\b|"
                r"\bquanto (eu )?(tenho|possuo)\b|\bmeu patrimonio\b|\bquanto (eu )?(ja )?"
                r"(ganhei|perdi)\b|\bcomo (esta|ta|vai) (a )?(minha )?carteira\b|"
                r"\bmeus (ativos|investimentos)\b|\bp&l\b|\bmeu resultado\b"),
     lambda m, t: _i("carteira")),

    # ---- cotação
    (re.compile(r"^/cotacao|^/preco|"
                r"\bcotacao\b|\bquanto (esta|ta|custa|vale)\b|\bpreco (da|de|do)\b|"
                r"\bfechou\b|\bfechamento\b"),
     lambda m, t: _com_tickers(t, "cotacao",
                               "De qual ativo? Ex: /cotacao PETR4 VALE3")),

    # ---- status
    (re.compile(r"^/status|^status$|"
                r"\bquanto (eu )?(ja )?gastei\b|\bgasto (do mes|da api)\b|"
                r"\bta (tudo )?(no ar|funcionando)\b|\bsaude do sistema\b|\bcustos?\b"),
     lambda m, t: _i("status")),

    # ---- link da web
    (re.compile(r"^/web$|^/site$|^/link$|\b(link|endereco|url) (do|da) (site|web|dashboard|painel)\b|"
                r"\babre? o (dashboard|painel|site)\b"),
     lambda m, t: _i("web")),
)


# --- Construtores -----------------------------------------------------------
def _primeiro_ticker(texto: str) -> str:
    achados = tickers.extrair(texto)
    return achados[0] if achados else ""


def _com_ticker(texto: str, nome: str, pedido: str) -> Intencao:
    ticker = _primeiro_ticker(texto)
    if not ticker:
        return Intencao(nome="falta_ticker", texto=pedido)
    return _i(nome, ticker=ticker)


def _com_tickers(texto: str, nome: str, pedido: str) -> Intencao:
    achados = tickers.extrair(texto)
    if not achados:
        return Intencao(nome="falta_ticker", texto=pedido)
    return _i(nome, tickers=achados)


def _analise(texto: str) -> Intencao:
    ticker = _primeiro_ticker(texto)
    if not ticker:
        return Intencao(
            nome="falta_ticker",
            texto="Qual ativo você quer que eu analise? Ex: /analise PETR4",
        )
    return _llm("analise",
                aviso=f"Analisando {tickers.curto(ticker)} — buscando dados e "
                      "lendo as notícias. Uns 20 segundos…",
                ticker=ticker)


def _pergunta(texto: str) -> Intencao:
    corpo = re.sub(r"^/perguntar?\s*", "", texto, flags=re.I).strip()
    if not corpo:
        return Intencao(
            nome="falta_pergunta",
            texto=("Escreva a pergunta depois do comando. Ex:\n"
                   "/pergunta vale mais a pena ITUB4 ou BBAS3 pra dividendos?\n\n"
                   "_Esse caminho usa IA com todas as ferramentas e custa "
                   "cerca de US$ 0,03._"),
        )
    return _llm("pergunta",
                aviso="Deixa eu pensar nisso com calma…", texto_livre=corpo)


def _ajuste_explicito(normal: str) -> Intencao:
    achado = AJUSTE.match(normal)
    if not achado:
        return Intencao(
            nome="ajuda_movimento",
            texto=("Para corrigir uma posição, informe ativo, cotas e preço médio:\n"
                   "*/ajustar PETR4 120 36,10*"),
        )
    return _i("ajustar", ticker=tickers.normalizar(achado.group("tic")),
              shares=achado.group("qtd"), preco=achado.group("preco"))


def _movimento(m: re.Match[str]) -> Intencao:
    verbo = m.group("verbo")
    tipo = "venda" if verbo.startswith("vend") else "compra"
    return _i(
        "movimento",
        tipo=tipo,
        ticker=tickers.normalizar(m.group("tic1") or m.group("tic2") or ""),
        shares=m.group("qtd1") or m.group("qtd2"),
        preco=m.group("preco"),
        data=m.group("data"),
    )


#: Comando explícito com barra, resolvido **antes** de qualquer palavra-chave.
#:
#: Existe por um bug concreto: `/pergunta analisa PETR4` casava com o padrão de
#: análise, porque a palavra "analisa" está no *argumento* do comando. O usuário
#: pediu conversa livre e recebeu (e pagou) outra rota. Comando explícito é
#: declaração de intenção: o que vem depois dele é argumento, não vocabulário.
COMANDOS: dict[str, Callable[[str], Intencao]] = {
    "ajuda": lambda t: _i("ajuda"),
    "help": lambda t: _i("ajuda"),
    "start": lambda t: _i("ajuda"),
    "menu": lambda t: _i("ajuda"),
    "limpar": lambda t: _i("limpar"),
    "reset": lambda t: _i("limpar"),
    "pergunta": _pergunta,
    "perguntar": _pergunta,
    "analise": _analise,
    "analisa": _analise,
    "briefing": lambda t: _i("confirmar_briefing"),
    "carteira": lambda t: _i("carteira"),
    "posicoes": lambda t: _i("carteira"),
    "cotacao": lambda t: _com_tickers(t, "cotacao",
                                      "De qual ativo? Ex: /cotacao PETR4 VALE3"),
    "preco": lambda t: _com_tickers(t, "cotacao",
                                    "De qual ativo? Ex: /cotacao PETR4 VALE3"),
    "noticias": lambda t: _i("noticias", ticker=_primeiro_ticker(t)),
    "news": lambda t: _i("noticias", ticker=_primeiro_ticker(t)),
    "extrato": lambda t: _i("extrato", ticker=_primeiro_ticker(t)),
    "historico": lambda t: _i("extrato", ticker=_primeiro_ticker(t)),
    "desfazer": lambda t: _i("desfazer"),
    "ajustar": lambda t: _ajuste_explicito(t),
    "ajuste": lambda t: _ajuste_explicito(t),
    "posicao": lambda t: _ajuste_explicito(t),
    "remover": lambda t: _com_ticker(t, "remover",
                                     "Qual ativo remover? Ex: /remover PETR4"),
    "apagar": lambda t: _com_ticker(t, "remover",
                                    "Qual ativo remover? Ex: /remover PETR4"),
    "perfil": lambda t: _i("perfil"),
    "onboarding": lambda t: _i("onboarding"),
    "questionario": lambda t: _i("onboarding"),
    "alocacao": lambda t: _i("alocacao"),
    "sugestao": lambda t: _i("sugestao"),
    "sugerir": lambda t: _i("sugestao"),
    "status": lambda t: _i("status"),
    "web": lambda t: _i("web"),
    "site": lambda t: _i("web"),
    "link": lambda t: _i("web"),
}


def _comando_explicito(normal: str) -> Intencao | None:
    """`/analise petr4` → a intenção de análise, sem consultar o vocabulário."""
    if not normal.startswith("/"):
        return None
    palavra = normal[1:].split()[0] if len(normal) > 1 else ""
    construtor = COMANDOS.get(palavra)
    if construtor is None:
        return None
    return construtor(normal)


# --- Resolução --------------------------------------------------------------
def resolver(texto: str, sessao: dict[str, Any] | None = None) -> Intencao:
    """Texto do usuário → intenção. **Puro**: nada de rede, banco ou modelo.

    `sessao` é o estado devolvido por `store.ler_sessao()`. É o que dá sentido a
    "sim" e a "3".
    """
    cru = (texto or "").strip()
    if not cru:
        return Intencao(nome="vazia", texto=texto_do_menu())

    normal = normalizar_texto(cru)
    sessao = sessao or {}
    fluxo = sessao.get("fluxo")

    # 1. Fluxo de onboarding engole tudo: as respostas são números e valores que
    #    casariam com meia dúzia de padrões lá embaixo.
    if fluxo == "onboarding":
        return _i("onboarding_resposta", resposta=cru)

    # 2. Confirmação pendente.
    if fluxo == "confirmacao":
        # Faltando só o preço, a mensagem seguinte É o preço: um "35,50" solto
        # não pode cair nos padrões lá embaixo nem descartar a proposta.
        if sessao.get("etapa") == "falta_preco":
            if NAO.match(normal):
                return _i("cancelar")
            return _i("informar_preco", preco=cru)
        if SIM.match(normal):
            return _i("confirmar")
        if NAO.match(normal):
            return _i("cancelar")
        # Qualquer outra coisa descarta a pendência e segue o fluxo normal — o
        # usuário nunca fica preso numa pergunta que não quer responder.
        logger.info("Confirmação pendente descartada por mensagem nova")
        return _substituir(resolver(cru, sessao={}))

    # 3. Saudação e agradecimento: a resposta é sempre a mesma.
    from investai.agent.assistant import resposta_rapida

    rapida = resposta_rapida(cru)
    if rapida:
        return Intencao(nome="saudacao", texto=rapida)

    # 4. Comando explícito com barra: vence qualquer palavra-chave.
    explicito = _comando_explicito(normal)
    if explicito is not None:
        return explicito

    # 5. Palavra-chave.
    for padrao, construtor in PADROES:
        achado = padrao.search(normal)
        if achado:
            return construtor(achado, normal)

    # 6. Número solto respondendo ao último menu.
    if normal in POR_NUMERO and sessao.get("menu_mostrado"):
        destino = POR_NUMERO[normal]
        return _do_menu(destino)

    # 7. Ticker solto: devolve a cotação (de graça) e oferece a análise (que custa).
    achados = tickers.extrair(cru)
    if achados and len(normal.split()) <= 3:
        return _i("cotacao", tickers=achados, oferecer_analise=True)

    # 8. Nada casou. Menu, nunca o modelo.
    return Intencao(nome="nao_entendi",
                    texto=texto_do_menu("Não entendi. 🤔"))


def _substituir(intencao: Intencao) -> Intencao:
    """Marca que havia uma pendência descartada, para o servidor avisar."""
    intencao.args["pendencia_descartada"] = True
    return intencao


#: Itens do menu que só pedem mais informação, em vez de executar algo.
PEDIDOS = {
    "pedir_cotacao": ("falta_ticker",
                      "De qual ativo? Escreva o código, ex: *PETR4*"),
    "pedir_analise": ("falta_ticker",
                      "Qual ativo eu analiso? Escreva o código, ex: *PETR4*\n\n"
                      "_A análise usa IA e custa cerca de US$ 0,02._"),
    "ajuda_movimento": ("ajuda_movimento",
                        "Escreva do seu jeito, por exemplo:\n"
                        "- *comprei 100 PETR4 a 35,50*\n"
                        "- *vendi 50 VALE3 a 68*\n"
                        "- *comprei 10 ITUB4 a 25 em 12/10*\n\n"
                        "Eu confirmo com você antes de gravar."),
}


def _do_menu(destino: str) -> Intencao:
    if destino in PEDIDOS:
        nome, texto = PEDIDOS[destino]
        return Intencao(nome=nome, texto=texto)
    if destino == "briefing":
        return _i("confirmar_briefing")
    return _i(destino)
