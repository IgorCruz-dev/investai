"""Monta uma carteira sugerida a partir do perfil + dados reais de mercado.

Divisão de responsabilidades, de propósito:

- `investai.onboarding.profile` decide **as camadas** (quanto em renda fixa, ETF, FII,
  ação) de forma determinística, a partir do questionário;
- `investai.analysis.screener` decide **quais ativos** podem entrar, por critérios
  objetivos sobre dados reais;
- este módulo distribui os pesos dentro de cada camada, por nota e com trava;
- `investai.analysis.triagem_noticia` pode **tirar** um aprovado por notícia
  grave, e é a única peça com um modelo de linguagem dentro.

Nenhum número desta carteira sai de um modelo: seleção, nota, peso e cota são
aritmética, e é isso que mantém a recomendação auditável. O veto por notícia
(spec 003, revisão de 27/10/2026) só subtrai candidato, nunca acrescenta e nunca
repesa — e quando ele não roda, a carteira sai igual, marcada sem triagem.

Isto é material informativo e educacional, não recomendação formal de
investimento (ver aviso no topo do dashboard).
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from investai.analysis.screener import ACAO, ETF, FII, Candidate, screen_detailed
from investai.analysis.triagem_noticia import Triagem, Veto, triar
from investai.config import Portfolio, Position
from investai.onboarding.profile import InvestorProfile
from investai.utils.formatters import money

logger = logging.getLogger(__name__)

#: Quantos ativos por classe entram na carteira sugerida. Mais que isso, para
#: quem começa com pouco, significa posições minúsculas e custo de acompanhar
#: alto sem ganho de diversificação.
MAX_ASSETS_PER_CLASS = {ETF: 2, FII: 3, ACAO: 5}

RENDA_FIXA_LABEL = "Tesouro Selic / CDB liquidez diária"

#: Valor mínimo por posição. Dividir R$ 1.000 entre 5 ações gera posições de
#: R$ 30 que não compram nem uma cota — melhor concentrar em menos ativos.
MIN_POSITION_BRL = 300.0

@dataclass
class RecommendedPosition:
    ticker: str
    name: str
    asset_class: str
    weight_pct: float
    amount: float
    price: float | None = None
    shares: float = 0.0
    rationale: str = ""
    sector: str = ""

    @property
    def invested(self) -> float:
        if self.price is None:
            return self.amount
        return self.shares * self.price


@dataclass
class Recommendation:
    profile: str = ""
    allocation: dict[str, float] = field(default_factory=dict)
    positions: list[RecommendedPosition] = field(default_factory=list)
    summary: str = ""
    risk_notes: str = ""
    next_steps: list[str] = field(default_factory=list)
    generated_at: datetime | None = None
    error: str | None = None
    rejected: dict[str, list[str]] = field(default_factory=dict)
    #: Ativos derrubados por notícia grave, com a frase que justificou cada um.
    vetos: list[Veto] = field(default_factory=list)
    #: Veto recusado pelos limites da spec (teto da classe, ou esvaziaria a
    #: classe): o ativo **ficou** na carteira, e o alerta aparece do lado dele.
    alertas: list[Veto] = field(default_factory=list)
    #: `False` quando a triagem de notícia não rodou — sem chave, sem notícia,
    #: API fora ou tempo estourado. A carteira é a mesma; o que falta é a
    #: camada de proteção, e dizer isso é obrigação (spec 003).
    triagem_ok: bool = False
    triagem_motivo: str = ""

    @property
    def ok(self) -> bool:
        return bool(self.positions)

    @property
    def leftover(self) -> float:
        """Caixa pendurado — e **deve ser zero**.

        Antes a fração de cota que não cabia ficava aqui. Hoje `distribute`
        manda toda a sobra do arredondamento para a camada de renda fixa, então
        esta propriedade deixou de ser "quanto sobrou" e passou a ser a
        verificação de que nada se perdeu no caminho.
        """
        return round(sum(p.amount - p.invested for p in self.positions), 2)

    def to_portfolio(self, currency: str = "BRL") -> Portfolio:
        """Converte em carteira **planejada** (sem preço de compra, sem P&L).

        Para renda fixa não existe cota: o campo `shares` guarda o valor em
        reais, e o cálculo da carteira trata essa classe com preço unitário 1.
        """
        return Portfolio(
            positions=tuple(
                Position(
                    ticker=p.ticker,
                    shares=round(p.amount if p.asset_class == "renda_fixa" else p.shares, 4),
                    avg_price=None,          # nada comprado ainda
                    asset_class=p.asset_class,
                    target_weight=p.weight_pct,
                )
                for p in self.positions
            ),
            currency=currency,
            planned=True,
        )


# --- Rateio determinístico --------------------------------------------------
def _pick(candidates: list[Candidate], limit: int) -> list[Candidate]:
    """Melhores candidatos, evitando concentrar o mesmo setor."""
    chosen: list[Candidate] = []
    sectors: set[str] = set()
    for candidate in candidates:
        sector = candidate.asset.sector
        if sector in sectors and len(chosen) < limit:
            continue  # tenta primeiro diversificar setor
        chosen.append(candidate)
        sectors.add(sector)
        if len(chosen) >= limit:
            break
    if len(chosen) < limit:  # sem diversidade suficiente, completa pelo score
        for candidate in candidates:
            if candidate not in chosen:
                chosen.append(candidate)
            if len(chosen) >= limit:
                break
    return chosen


#: Trava dos pesos dentro de uma classe, como fator do peso igual. Proporcionalidade
#: pura é instável: entre notas 72 e 68 a diferença de peso tem que ser pequena,
#: porque a nota não é precisa o suficiente para justificar uma posição três vezes
#: maior. A trava é o que transforma uma ordenação confiável em pesos confiáveis.
PESO_MIN_FATOR = 0.5
PESO_MAX_FATOR = 1.6


def _pesos_por_nota(chosen: list[Candidate], class_weight: float) -> list[float]:
    """Pesos dentro da classe: proporcionais à nota, travados, renormalizados."""
    if len(chosen) == 1:
        return [class_weight]

    igual = class_weight / len(chosen)
    # Nota 0 não zera a posição: o ativo foi aprovado, então ele merece piso.
    notas = [max(c.score, 1.0) for c in chosen]
    total = sum(notas)

    travados = [
        min(max(class_weight * nota / total, igual * PESO_MIN_FATOR), igual * PESO_MAX_FATOR)
        for nota in notas
    ]
    soma = sum(travados)
    return [peso * class_weight / soma for peso in travados]


def distribute(profile: InvestorProfile,
               by_class: dict[str, list[Candidate]]) -> list[RecommendedPosition]:
    """Divide cada camada entre os melhores candidatos, com peso pela nota.

    Duas regras da spec 003 moram aqui:

    - **Peso proporcional à nota, com trava** (`_pesos_por_nota`), em vez de
      partes iguais.
    - **A sobra não desaparece.** `piso(valor / preço)` sempre deixa troco, e
      somado em dez posições o troco é dinheiro de verdade. Ele vai todo para a
      camada de renda fixa, que tem liquidez diária e aceita qualquer valor —
      então a soma das posições é **exatamente** o valor disponível.
    """
    positions: list[RecommendedPosition] = []
    investable = profile.investable_amount
    # Quanto foi DESTINADO às classes de bolsa que tinham candidato. A sobra é a
    # diferença entre isto e o que de fato virou cota — e calcular assim, no
    # fim, em vez de somar a diferença de cada posição, é o que faz a conta
    # fechar no centavo. Somando por posição, o arredondamento de cada `amount`
    # escapava da conta e a carteira passava alguns centavos do disponível.
    destinado_bolsa = 0.0
    peso_renda_fixa = 0.0

    for asset_class, class_weight in (profile.allocation or {}).items():
        if class_weight <= 0:
            continue

        # A renda fixa é a última, porque ela recebe a sobra de todas as outras.
        if asset_class == "renda_fixa":
            peso_renda_fixa = class_weight
            continue

        candidates = by_class.get(asset_class) or []
        if not candidates:
            # O dinheiro desta classe NÃO é realocado para a renda fixa.
            #
            # Seria o conserto fácil para a soma fechar, e seria errado: mandar
            # os 30% de ação para a liquidez porque o yfinance caiu entrega uma
            # carteira que ninguém pediu, com a cara de recomendação deliberada.
            # Quem declara o buraco é `recommend()`, em texto.
            logger.warning("Nenhum candidato aprovado para a classe %s", asset_class)
            continue

        # Só classe com candidato entra na conta: o dinheiro de uma classe vazia
        # não é realocado, e por isso ele também não aparece como sobra.
        destinado_bolsa += investable * class_weight / 100

        class_amount = investable * class_weight / 100
        max_assets = MAX_ASSETS_PER_CLASS.get(asset_class, 3)
        if class_amount > 0:
            # Com pouco dinheiro, melhor menos ativos do que posições inviáveis.
            affordable = int(class_amount // MIN_POSITION_BRL)
            max_assets = max(1, min(max_assets, affordable or 1))

        chosen = _pick(candidates, max_assets)
        for candidate, weight in zip(chosen, _pesos_por_nota(chosen, class_weight),
                                     strict=True):
            price = candidate.indicators.get("price_current")
            amount = round(investable * weight / 100, 2)

            if not price:
                # `evaluate` rejeita candidato sem preço, então isto é defesa:
                # sem cotação não há como dizer quantas cotas comprar. O dinheiro
                # dele cai na sobra sozinho, por não virar posição nenhuma.
                continue

            shares = float(math.floor(amount / price))
            if shares <= 0:
                # Nem uma cota cabe no peso calculado: o dinheiro vai para a
                # renda fixa em vez de virar uma posição de zero cota.
                continue

            aplicado = round(shares * price, 2)

            positions.append(RecommendedPosition(
                ticker=candidate.asset.ticker,
                name=candidate.asset.name,
                asset_class=asset_class,
                sector=candidate.asset.sector,
                weight_pct=round(aplicado / investable * 100, 2) if investable else round(weight, 2),
                amount=aplicado,
                price=price,
                shares=shares,
                rationale="; ".join(candidate.reasons) or "aprovado nos critérios do perfil",
            ))

    aplicado_bolsa = round(sum(p.amount for p in positions), 2)
    sobra = round(destinado_bolsa - aplicado_bolsa, 2)
    renda_fixa = round(investable * peso_renda_fixa / 100 + sobra, 2)
    if renda_fixa > 0:
        motivo = (
            "Camada de estabilidade e liquidez. Acompanha a Selic, tem liquidez diária e "
            "serve de colchão para não precisar vender ação em queda."
        )
        if sobra > 0:
            motivo += (
                f" Inclui {money(sobra)} de sobra do arredondamento das cotas, "
                "para a carteira somar exatamente o valor disponível."
            )
        positions.append(RecommendedPosition(
            ticker=RENDA_FIXA_LABEL, name="Renda fixa pós-fixada", asset_class="renda_fixa",
            weight_pct=round(renda_fixa / investable * 100, 2) if investable else peso_renda_fixa,
            amount=renda_fixa, price=None, shares=1.0, sector="Renda fixa",
            rationale=motivo,
        ))

    return positions


# --- O veto por notícia -----------------------------------------------------
def _aplicar_vetos(
    by_class: dict[str, list[Candidate]], vetos: dict[str, Veto]
) -> tuple[dict[str, list[Candidate]], list[Veto], list[Veto]]:
    """Tira os candidatos vetados, com os dois limites da spec 003.

    - **Teto de um ativo por classe por rodada.** Sem teto, um dia de manchete
      ruim derrubaria a carteira inteira e o "cálculo decide" viraria letra
      morta.
    - **Nunca esvazia uma classe.** Veto que deixaria a classe sem nenhum
      candidato é descartado e o ativo fica, com o alerta visível. A spec já
      manda não realocar classe vazia para a renda fixa; deixar o veto criar
      esse buraco seria piorar a carteira por causa de uma notícia.

    O screener entrega cada classe ordenada por nota decrescente, e esta função
    respeita essa ordem: se dois ativos da mesma classe foram vetados, cai o de
    nota maior — que é o que de fato entraria na carteira. Vetar o que não seria
    escolhido não protege ninguém.

    Devolve `(classes filtradas, vetos aplicados, vetos descartados)`.
    """
    aplicados: list[Veto] = []
    descartados: list[Veto] = []
    filtrado: dict[str, list[Candidate]] = {}

    for asset_class, candidatos in by_class.items():
        restantes = list(candidatos)
        teto_gasto = False
        for candidato in candidatos:
            veto = vetos.get(candidato.asset.ticker)
            if veto is None:
                continue
            if teto_gasto or len(restantes) <= 1:
                descartados.append(veto)
                continue
            # Por identidade, não por igualdade: `Candidate` é um dataclass que
            # carrega dicts de indicadores, e `list.remove` compararia valor por
            # valor para achar o elemento.
            restantes = [c for c in restantes if c is not candidato]
            aplicados.append(veto)
            teto_gasto = True
        filtrado[asset_class] = restantes

    return filtrado, aplicados, descartados


# --- API pública ------------------------------------------------------------
def recommend(profile: InvestorProfile, market_data: dict[str, dict[str, Any]],
              *, triagem: bool = False, currency: str = "BRL") -> Recommendation:
    """Gera a carteira sugerida. Nunca levanta exceção.

    Seleção, nota, peso e cota são **cálculo, sempre**: nenhum número daqui sai
    de um modelo de linguagem. É o que torna a carteira reproduzível e auditável,
    com o porquê de cada peso em número.

    `triagem` é **False** por padrão, e isso é a regra de custo, não preferência.
    A triagem de notícia é o quarto caminho pago do produto (spec 003, revisão de
    27/10/2026) e só o job da VM a liga. Ela pode apenas **tirar** um aprovado
    por notícia grave; quando não roda, a carteira sai idêntica e `triagem_ok`
    fica `False` para a tela dizer que faltou essa camada.
    """
    # Nada a alocar em risco agora: o dinheiro de hoje vai todo para o que vem
    # antes — completar a reserva, ou quitar dívida cara. Sai aqui, antes do
    # filtro e antes da triagem.
    #
    # Isto não é detalhe de eficiência. Seguindo adiante, a carteira sai vazia e
    # a mensagem de "nenhum ativo passou" culpa o filtro de mercado e manda
    # revisar o questionário — mentira e mau conselho. A spec 002 diz o
    # contrário: nesse estado, o pré-requisito **é** a recomendação mais valiosa
    # que o sistema tem para dar.
    if profile.investable_amount <= 0:
        pendentes = "; ".join(
            f"{p.title} ({money(p.amount)})" if p.amount else p.title
            for p in profile.prerequisites
        )
        return Recommendation(
            profile=profile.profile,
            allocation=profile.allocation,
            generated_at=datetime.now(),
            risk_notes=_fallback_risks(profile),
            triagem_motivo="sem valor a alocar; triagem desnecessária",
            error=(
                "Ainda não há valor para alocar em risco: o dinheiro de agora vai para o que "
                "precisa vir antes"
                + (f" — {pendentes}" if pendentes else "")
                + ". Não é falha do filtro de ativos nem do seu questionário, é a ordem certa: "
                "a reserva existe para estar disponível justamente quando a bolsa estiver "
                "caindo. A alocação-alvo abaixo passa a valer quando sobrar dinheiro depois "
                "dela."
            ),
        )

    by_class, rejected_candidates = screen_detailed(
        profile.profile, market_data, profile.allocation
    )

    # A classe de cada aprovado, guardada ANTES do veto: o vetado sai de
    # `by_class`, e depois disso não há mais onde descobrir a classe dele.
    classe_de = {
        c.asset.ticker: asset_class
        for asset_class, candidatos in by_class.items() for c in candidatos
    }

    resultado = Triagem(ok=False, motivo="triagem de notícia não solicitada")
    vetados: list[Veto] = []
    alertas: list[Veto] = []
    if triagem:
        aprovados = [c for candidatos in by_class.values() for c in candidatos]
        resultado = triar(aprovados)
        if resultado.vetos:
            by_class, vetados, alertas = _aplicar_vetos(by_class, resultado.vetos)

    positions = distribute(profile, by_class)

    rejected: dict[str, list[str]] = {}
    for candidate in rejected_candidates:
        rejected.setdefault(candidate.asset.asset_class, []).append(
            f"{candidate.asset.ticker} ({candidate.asset.name}): "
            + "; ".join(candidate.rejections)
        )

    # O vetado entra na mesma lista dos rejeitados, com a origem marcada: quem
    # lê precisa distinguir "o número reprovou" de "a notícia reprovou".
    for veto in vetados:
        rejected.setdefault(classe_de.get(veto.ticker, "acao"), []).append(
            f"[notícia] {veto.ticker}: {veto.motivo} — \u201c{veto.frase}\u201d"
            + (f" ({veto.fonte})" if veto.fonte else "")
        )

    recommendation = Recommendation(
        profile=profile.profile,
        allocation=profile.allocation,
        positions=positions,
        generated_at=datetime.now(),
        summary=_fallback_summary(profile, positions),
        risk_notes=_fallback_risks(profile),
        next_steps=_fallback_next_steps(profile),
        rejected=rejected,
        vetos=vetados,
        alertas=alertas,
        triagem_ok=resultado.ok,
        triagem_motivo=resultado.motivo,
    )

    # Classe com peso no perfil e sem nenhuma posição: o filtro não achou nada
    # aprovável nela. A carteira abaixo não soma o valor disponível, e dizer isso
    # é obrigação — a pessoa precisa saber que falta alocar.
    classes_vazias = [
        asset_class for asset_class, weight in (profile.allocation or {}).items()
        if weight > 0 and asset_class != "renda_fixa"
        and not any(p.asset_class == asset_class for p in positions)
    ]

    if not positions:
        recommendation.error = (
            "Nenhum ativo passou pelos critérios do seu perfil com os dados atuais. "
            "Tente atualizar os dados de mercado ou revise o questionário."
        )
        return recommendation

    # A camada de renda fixa não depende de cotação, então ela sai mesmo com o
    # yfinance fora do ar — mas aí a carteira está incompleta e isso precisa
    # ficar explícito, em vez de parecer uma recomendação deliberada.
    if all(p.asset_class == "renda_fixa" for p in positions):
        recommendation.error = (
            "Não foi possível avaliar nenhum ativo de bolsa com os dados disponíveis agora "
            "(yfinance indisponível ou sem histórico). Abaixo está apenas a camada de renda "
            "fixa; atualize os dados e gere a recomendação de novo para a parte de risco."
        )
        return recommendation

    if classes_vazias:
        faltando = sum((profile.allocation or {}).get(c, 0.0) for c in classes_vazias)
        recommendation.error = (
            "Nenhum ativo de "
            + ", ".join(classes_vazias)
            + f" passou pelos critérios do seu perfil com os dados de agora, então "
            f"{faltando:.0f}% da carteira ficou sem alocação. O que está abaixo é o "
            "resto, e não a carteira inteira — veja os rejeitados para o motivo de "
            "cada um."
        )

    return recommendation


# --- Textos do modo determinístico ------------------------------------------
def _fallback_summary(profile: InvestorProfile, positions: list[RecommendedPosition]) -> str:
    if not positions:
        return ""
    linhas = [
        f"Carteira sugerida para perfil **{profile.profile}** "
        f"(score {profile.risk_score:.0f}/100, horizonte de {profile.horizon_years:.0f} anos), "
        f"com {money(profile.investable_amount)} disponíveis para investir agora.",
        "",
        "A divisão por classe vem de regra determinística baseada no seu questionário, e os "
        "ativos de cada classe foram escolhidos por filtro quantitativo sobre dados reais "
        "(liquidez, múltiplos, endividamento, volatilidade e tendência).",
    ]
    return "\n".join(linhas)


def _fallback_risks(profile: InvestorProfile) -> str:
    riscos = [
        "- **Concentração em Brasil:** mesmo com ETF internacional, a maior parte da carteira "
        "fica exposta ao ciclo econômico e político brasileiro.",
        "- **Oscilação de curto prazo:** a parte de ações e FIIs pode cair 20% ou mais em "
        "crises, sem que isso signifique que a tese está errada.",
    ]
    if profile.emergency_gap > 0:
        riscos.append(
            "- **Reserva incompleta:** enquanto ela não estiver pronta, qualquer imprevisto "
            "pode forçar a venda de ativos no pior momento."
        )
    if profile.horizon_years < 5:
        riscos.append(
            f"- **Horizonte curto ({profile.horizon_years:.0f} anos):** há risco real de "
            "precisar resgatar em um momento de queda."
        )
    return "\n".join(riscos)


def _fallback_next_steps(profile: InvestorProfile) -> list[str]:
    steps: list[str] = []
    for pre in profile.prerequisites:
        steps.append(pre.title)
    steps.append("Abrir conta em uma corretora e executar as compras aos poucos, não tudo de uma vez")
    if profile.monthly_contribution > 0:
        steps.append(
            f"Automatizar o aporte mensal de {money(profile.monthly_contribution)} e rebalancear "
            "a carteira a cada 6 meses"
        )
    steps.append("Reavaliar o perfil depois da primeira queda forte de mercado que você viver")
    return steps
