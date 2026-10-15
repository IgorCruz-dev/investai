"""Registrar compra e venda: parsing, validação em camadas e confirmação.

Um módulo só, usado pelo assistente do WhatsApp **e** pelas rotas da interface
web. Duas validações divergiriam na primeira exceção, e a que ficasse mais
frouxa seria a porta de entrada de dado torto na carteira.

A ordem das camadas é da mais barata para a mais cara, porque não faz sentido
consultar o mercado para descobrir que a quantidade era zero:

1. **formato e faixa** — local, instantâneo;
2. **posição disponível** — uma consulta ao banco (na venda);
3. **existência no mercado** — yfinance, só na VM;
4. **sanidade do preço** — compara com o fechamento e *avisa* em vez de recusar,
   porque preço muito fora do mercado é suspeito, não impossível.

E nada grava na primeira mensagem: toda escrita produz uma `Proposta`, que vira
texto de confirmação e só é aplicada depois do "sim". O LLM, se um dia propuser
uma compra, entra por aqui — propor é dele, decidir é deste módulo.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from src.config import save_portfolio
from src.data import market_data, repo
from src.utils.formatters import money, number, parse_number_br, percent
from src.utils.tickers import curto, normalizar

logger = logging.getLogger(__name__)

TIPOS = ("compra", "venda", "ajuste", "remocao")

#: Acima disso, o preço informado destoa tanto do mercado que vale destacar na
#: confirmação. Pega o caso clássico: 35,50 digitado como 3550.
DESVIO_SUSPEITO = 0.5

#: Teto de sanidade. Ninguém registra um bilhão de cotas, e o número redondo
#: evita que um dedo escorregado no zero vire uma carteira de mentira.
MAX_SHARES = 1e9
MAX_PRECO = 1e7


@dataclass
class Proposta:
    """Uma escrita pendente de confirmação. `erro` preenchido = recusada."""

    tipo: str = ""
    ticker: str = ""
    shares: float = 0.0
    preco: float = 0.0
    taxas: float = 0.0
    data: date = field(default_factory=date.today)
    #: Observações que o usuário precisa ver antes de confirmar.
    avisos: list[str] = field(default_factory=list)
    #: Contexto de mercado, quando deu para buscar.
    preco_mercado: float | None = None
    #: Posição antes da operação, para o texto de confirmação.
    shares_atual: float = 0.0
    avg_atual: float | None = None
    #: Quantas movimentações a remoção vai apagar.
    movimentacoes_afetadas: int = 0
    erro: str = ""

    @property
    def ok(self) -> bool:
        return not self.erro and bool(self.tipo)

    @property
    def total(self) -> float:
        return self.shares * self.preco + self.taxas

    def as_dict(self) -> dict[str, Any]:
        """Serializável para a sessão em SQLite."""
        return {
            "tipo": self.tipo, "ticker": self.ticker, "shares": self.shares,
            "preco": self.preco, "taxas": self.taxas, "data": self.data.isoformat(),
            "avisos": self.avisos, "preco_mercado": self.preco_mercado,
            "shares_atual": self.shares_atual, "avg_atual": self.avg_atual,
            "movimentacoes_afetadas": self.movimentacoes_afetadas,
        }

    @classmethod
    def from_dict(cls, dados: dict[str, Any]) -> "Proposta":
        dados = dict(dados or {})
        bruta = dados.pop("data", None)
        return cls(data=date.fromisoformat(bruta) if bruta else date.today(), **dados)


def _recusa(motivo: str) -> Proposta:
    return Proposta(erro=motivo)


# --- Camada 1: formato e faixa ----------------------------------------------
def _ler_data(texto: str | None) -> date | str:
    """`"12/10"` → data deste ano. Devolve o motivo da recusa como string."""
    if not texto:
        return date.today()
    bruto = str(texto).strip().replace("-", "/")
    for formato in ("%d/%m/%Y", "%d/%m/%y", "%d/%m"):
        try:
            lido = datetime.strptime(bruto, formato).date()
        except ValueError:
            continue
        if formato == "%d/%m":
            lido = lido.replace(year=date.today().year)
        if lido > date.today():
            return (f"A data {lido.strftime('%d/%m/%Y')} está no futuro. "
                    "Registro é de negócio que já aconteceu.")
        if lido.year < 1990:
            return f"A data {lido.strftime('%d/%m/%Y')} parece errada."
        return lido
    return f'Não entendi a data "{texto}". Use dia/mês, por exemplo 12/10.'


def montar(tipo: str, ticker: str, shares: Any = None, preco: Any = None,
           data: Any = None, taxas: Any = 0, *, conferir_mercado: bool = True) -> Proposta:
    """Valida os dados crus e devolve a proposta, ou uma recusa com o motivo.

    `conferir_mercado=False` desliga as camadas 3 e 4 — é o que a interface web
    usa, porque yfinance só existe na VM; lá o ticker entra como pendente e o
    cron confere depois.
    """
    if tipo not in TIPOS:
        return _recusa(f"Tipo de movimento desconhecido: {tipo}")

    codigo = normalizar(str(ticker or ""))
    if not codigo:
        return _recusa("Faltou o código do ativo. Ex: PETR4")

    if tipo == "remocao":
        return _montar_remocao(codigo)

    quantidade = parse_number_br(shares)
    if quantidade is None:
        return _recusa(f"Não entendi a quantidade de cotas de {curto(codigo)}.")
    if quantidade <= 0:
        return _recusa("A quantidade precisa ser maior que zero.")
    if quantidade > MAX_SHARES:
        return _recusa(f"{number(quantidade, 0)} cotas? Esse número não parece real.")

    valor = parse_number_br(preco)
    if valor is None:
        # Faltar o preço é comum e não é erro: quem chama pergunta, mostrando a
        # cotação de hoje como sugestão.
        return Proposta(tipo=tipo, ticker=codigo, shares=quantidade, preco=0.0,
                        erro="FALTA_PRECO")
    if valor <= 0:
        return _recusa("O preço precisa ser maior que zero.")
    if valor > MAX_PRECO:
        return _recusa(f"{money(valor)} por cota? Esse preço não parece real.")

    corretagem = parse_number_br(taxas) or 0.0
    if corretagem < 0:
        return _recusa("As taxas não podem ser negativas.")

    quando = _ler_data(data)
    if isinstance(quando, str):
        return _recusa(quando)

    proposta = Proposta(tipo=tipo, ticker=codigo, shares=quantidade, preco=valor,
                        taxas=corretagem, data=quando)

    _carregar_posicao(proposta)
    if tipo == "venda" and (erro := _conferir_venda(proposta)):
        return _recusa(erro)
    if conferir_mercado:
        _conferir_mercado(proposta)
    return proposta


def _montar_remocao(codigo: str) -> Proposta:
    proposta = Proposta(tipo="remocao", ticker=codigo, data=date.today())
    _carregar_posicao(proposta)
    try:
        proposta.movimentacoes_afetadas = repo.total_movimentacoes(codigo)
    except Exception as exc:  # noqa: BLE001
        logger.warning("não foi possível contar as movimentações: %s", exc)
    if not proposta.movimentacoes_afetadas:
        return _recusa(f"{curto(codigo)} não está na sua carteira — não há o que remover.")
    return proposta


# --- Camada 2: posição disponível -------------------------------------------
def _carregar_posicao(proposta: Proposta) -> None:
    """Preenche a posição atual. Falha de banco não invalida a proposta."""
    try:
        atual = next((p for p in repo.posicoes().positions
                      if p.ticker == proposta.ticker), None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("posição atual indisponível (%s)", exc.__class__.__name__)
        return
    if atual:
        proposta.shares_atual = atual.shares
        proposta.avg_atual = atual.avg_price


def _conferir_venda(proposta: Proposta) -> str:
    """O banco também recusa, mas aqui a mensagem é melhor e vem antes do "sim"."""
    if proposta.shares_atual <= 0:
        return (f"Você não tem {curto(proposta.ticker)} na carteira. "
                "Se foi uma compra, escreva \"comprei\".")
    if proposta.shares > proposta.shares_atual:
        return (f"Você tem {number(proposta.shares_atual, 0)} cotas de "
                f"{curto(proposta.ticker)} e quer vender {number(proposta.shares, 0)}. "
                "Confira a quantidade.")
    return ""


# --- Camadas 3 e 4: mercado -------------------------------------------------
def _conferir_mercado(proposta: Proposta) -> None:
    """Existência do ticker (recusa) e sanidade do preço (avisa).

    `market_data` nunca levanta exceção: devolve DataFrame vazio. Vazio aqui
    pode ser ticker inexistente **ou** Yahoo fora do ar, e as duas coisas não
    merecem o mesmo tratamento — por isso a recusa só vale quando o ativo
    também não está no catálogo nem na carteira.
    """
    try:
        precos = market_data.get_stock_data(proposta.ticker)
    except Exception as exc:  # noqa: BLE001
        logger.warning("mercado indisponível para %s: %s", proposta.ticker, exc)
        return

    if precos.empty:
        if proposta.shares_atual > 0:
            proposta.avisos.append(
                f"Não consegui confirmar {curto(proposta.ticker)} no mercado agora, "
                "mas o ativo já está na sua carteira.")
            return
        proposta.erro = (
            f"Não encontrei {curto(proposta.ticker)} no mercado. Confira o código — "
            "papel da B3 tem 4 letras e 1 ou 2 números (PETR4, KLBN11).")
        return

    try:
        atual = float(precos["Close"].dropna().iloc[-1])
    except (KeyError, IndexError, ValueError):
        return

    proposta.preco_mercado = atual
    if atual <= 0:
        return

    desvio = proposta.preco / atual - 1
    if abs(desvio) > DESVIO_SUSPEITO:
        proposta.avisos.append(
            f"⚠️ {money(proposta.preco)} por cota é {percent(abs(desvio) * 100, signed=False)} "
            f"{'acima' if desvio > 0 else 'abaixo'} do mercado "
            f"({money(atual)} hoje). Confira se não faltou ou sobrou uma vírgula.")


# --- Texto de confirmação ---------------------------------------------------
def texto_confirmacao(proposta: Proposta) -> str:
    """A mensagem que o usuário lê antes de qualquer coisa ser gravada."""
    if proposta.tipo == "remocao":
        linhas = [
            "*Remover da carteira* — confirma?",
            f"{curto(proposta.ticker)}: {number(proposta.shares_atual, 0)} cotas "
            f"e {proposta.movimentacoes_afetadas} movimentação(ões) de histórico",
            "",
            "Isso apaga o histórico do ativo e *não tem volta*. "
            "Se você vendeu, o certo é registrar a venda (\"vendi …\").",
            "",
            "Responda *sim* para apagar ou *não* para desistir.",
        ]
        return "\n".join(linhas)

    rotulos = {"compra": "Compra", "venda": "Venda", "ajuste": "Ajuste de posição"}
    linhas = [f"*{rotulos[proposta.tipo]}* — confirma?"]

    linhas.append(
        f"{number(proposta.shares, 0) if proposta.shares == int(proposta.shares) else number(proposta.shares)}"
        f" {curto(proposta.ticker)} a {money(proposta.preco)}"
        + (f" + {money(proposta.taxas)} de taxas" if proposta.taxas else "")
    )
    linhas.append(f"Total: {money(proposta.total)}"
                  + (f" · em {proposta.data.strftime('%d/%m/%Y')}"
                     if proposta.data != date.today() else ""))

    if proposta.preco_mercado:
        linhas.append(f"Mercado hoje: {money(proposta.preco_mercado)}")

    if proposta.tipo == "venda" and proposta.avg_atual:
        resultado = proposta.shares * (proposta.preco - proposta.avg_atual) - proposta.taxas
        linhas.append(
            f"Resultado apurado: {money(resultado)} "
            f"(preço médio {money(proposta.avg_atual)})")
    elif proposta.tipo == "compra" and proposta.shares_atual > 0:
        novo_total = proposta.shares_atual + proposta.shares
        custo = (proposta.shares_atual * (proposta.avg_atual or 0)) + proposta.total
        linhas.append(
            f"Posição passa a {number(novo_total, 0)} cotas, "
            f"preço médio {money(custo / novo_total)}")
    elif proposta.tipo == "ajuste" and proposta.shares_atual > 0:
        linhas.append(
            f"Hoje: {number(proposta.shares_atual, 0)} cotas a "
            f"{money(proposta.avg_atual)} — o ajuste sobrescreve isso")

    for aviso in proposta.avisos:
        linhas += ["", aviso]

    linhas += ["", "Responda *sim* para gravar ou *não* para descartar."]
    return "\n".join(linhas)


# --- Gravação ---------------------------------------------------------------
def aplicar(proposta: Proposta, origem: str = "whatsapp") -> str:
    """Grava a proposta e devolve a confirmação já formatada.

    Só é chamada depois do "sim". Levanta `repo.ErroDeEscrita` quando o banco
    recusa — quem chama traduz para o usuário.
    """
    if not proposta.ok and proposta.erro != "FALTA_PRECO":
        return f"Não gravei: {proposta.erro}"

    if proposta.tipo == "remocao":
        apagadas = repo.apagar_ticker(proposta.ticker)
        _espelhar()
        return (f"Removi {curto(proposta.ticker)} da carteira "
                f"({apagadas} movimentação(ões) apagada(s)). 🗑️\n\n{resumo_carteira()}")

    repo.garantir_ativo(proposta.ticker, classe=_classe_de(proposta.ticker))
    id_mov = repo.registrar_movimento(repo.Movimento(
        tipo=proposta.tipo, ticker=proposta.ticker, shares=proposta.shares,
        preco=proposta.preco, taxas=proposta.taxas, data=proposta.data, origem=origem,
    ))
    _espelhar()

    verbos = {"compra": "Compra registrada", "venda": "Venda registrada",
              "ajuste": "Posição ajustada"}
    linhas = [f"{verbos[proposta.tipo]}. ✅  _#{id_mov}_"]

    atual = next((p for p in repo.posicoes().positions
                  if p.ticker == proposta.ticker), None)
    if atual:
        linhas.append(f"{curto(proposta.ticker)}: {number(atual.shares, 0)} cotas, "
                      f"preço médio {money(atual.avg_price)}")
    else:
        linhas.append(f"{curto(proposta.ticker)}: posição encerrada.")

    if proposta.tipo == "venda":
        linhas.append(f"Resultado realizado acumulado: {money(repo.resultado_realizado())}")

    linhas += ["", resumo_carteira()]
    return "\n".join(linhas)


def _classe_de(ticker: str) -> str:
    """Classe do ativo pelo universo curado; cai em "acao" para o que não conhece."""
    from src.analysis.screener import UNIVERSE

    for ativo in UNIVERSE:
        if ativo.ticker == ticker:
            return ativo.asset_class
    return "acao"


def _espelhar() -> None:
    """Grava `config/portfolio.json` com a carteira do banco.

    Best-effort de propósito: o espelho serve para o Streamlit local, para o
    backup legível e para a leitura degradada quando o banco está fora. Se a
    escrita do arquivo falhar, a carteira no banco já está certa e o usuário
    não precisa saber disso.
    """
    try:
        save_portfolio(repo.posicoes())
    except Exception as exc:  # noqa: BLE001
        logger.warning("não foi possível espelhar a carteira em disco: %s", exc)


def resumo_carteira() -> str:
    """Uma linha com o estado da carteira, para fechar a mensagem de gravação."""
    try:
        carteira = repo.posicoes()
        if not carteira.positions:
            return "_Carteira vazia._"
        custo = sum(p.shares * (p.avg_price or 0) for p in carteira.positions)
        return (f"_Carteira: {len(carteira.positions)} ativo(s), "
                f"{money(custo)} investidos._")
    except Exception:  # noqa: BLE001
        return ""
