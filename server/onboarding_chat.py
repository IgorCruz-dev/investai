"""O questionário de perfil por conversa, no WhatsApp.

Reusa `src/onboarding/questionnaire.py` inteiro: as 18 perguntas, os textos de
ajuda e as opções já estão lá, escritas e revisadas para o dashboard. Aqui só
existe a **condução** — como renderizar cada tipo de pergunta numa mensagem de
celular, como ler a resposta e como andar para frente e para trás.

Nenhuma chamada de modelo em todo o fluxo: a pergunta é texto fixo e a resposta
é um número. Dezoito perguntas pelo agente com ferramentas custariam mais de
US$ 0,50 para produzir exatamente o mesmo perfil.

Estado na sessão (SQLite): `{fluxo: "onboarding", idx: 4, respostas: {...}}`.
Com TTL longo, porque responder 18 perguntas no celular não é coisa de um
minuto — dá para parar no meio e voltar depois do almoço.
"""

from __future__ import annotations

import logging
from typing import Any

from server import store
from src.data import repo
from src.onboarding.profile import build_profile
from src.onboarding.questionnaire import (
    QUESTIONS,
    STEPS,
    Question,
    missing_answers,
)
from src.utils.formatters import money, number, parse_number_br, percent

logger = logging.getLogger(__name__)

TOTAL = len(QUESTIONS)
ROTULO_DO_BLOCO = dict(STEPS)

VOLTAR = {"voltar", "volta", "anterior", "atras", "atrás", "<"}
PULAR = {"pular", "pula", "skip", "nenhum", "nenhuma", "0"}
CANCELAR = {"cancelar", "cancela", "parar", "para", "sair", "desistir", "/cancelar"}
AJUDA = {"?", "ajuda", "explica", "nao entendi", "não entendi", "como assim"}


# --- Entrada e saída do fluxo -----------------------------------------------
def iniciar(numero: str) -> str:
    ja_tem = bool(repo.perfil().get("profile")) if repo.configurado() else False
    abertura = [
        "*Questionário de perfil*",
        f"{TOTAL} perguntas, em 4 blocos. A maioria é escolher um número.",
        "",
        "Pode parar no meio e voltar depois — eu guardo onde você estava. "
        "A qualquer momento: *voltar* para a anterior, *?* para eu explicar, "
        "*cancelar* para desistir.",
    ]
    if ja_tem:
        abertura.insert(1, "_(você já tem um perfil salvo; ele só é substituído "
                           "no fim, se você confirmar)_")

    store.gravar_sessao(numero, {"fluxo": "onboarding", "idx": 0, "respostas": {}},
                        store.TTL_FLUXO)
    return "\n".join(abertura) + "\n\n" + _render(0)


def responder(numero: str, texto: str) -> str:
    """Processa uma resposta e devolve a próxima pergunta (ou o resumo final)."""
    sessao = store.ler_sessao(numero)
    if sessao.get("fluxo") != "onboarding":
        return iniciar(numero)

    idx = int(sessao.get("idx") or 0)
    respostas: dict[str, Any] = dict(sessao.get("respostas") or {})
    bruto = (texto or "").strip()
    normal = bruto.lower()

    if normal in CANCELAR:
        store.limpar_sessao(numero)
        return ("Questionário cancelado — não salvei nada. "
                "Quando quiser retomar, manda */onboarding*.")

    if normal in AJUDA:
        return _render(idx, com_ajuda=True)

    if normal in VOLTAR:
        if idx == 0:
            return "Essa já é a primeira pergunta.\n\n" + _render(0)
        idx -= 1
        # Apagar a resposta anterior: voltar e não responder de novo não pode
        # deixar o valor velho valendo.
        respostas.pop(QUESTIONS[idx].key, None)
        store.gravar_sessao(numero, {"fluxo": "onboarding", "idx": idx,
                                     "respostas": respostas}, store.TTL_FLUXO)
        return _render(idx)

    pergunta = QUESTIONS[idx]

    if normal in PULAR and not pergunta.required:
        respostas[pergunta.key] = []
        return _avancar(numero, idx, respostas)

    valor, erro = _ler_resposta(pergunta, bruto)
    if erro:
        return f"{erro}\n\n{_render(idx)}"

    respostas[pergunta.key] = valor
    return _avancar(numero, idx, respostas)


def _avancar(numero: str, idx: int, respostas: dict[str, Any]) -> str:
    proximo = idx + 1
    if proximo < TOTAL:
        store.gravar_sessao(numero, {"fluxo": "onboarding", "idx": proximo,
                                     "respostas": respostas}, store.TTL_FLUXO)
        aviso = ""
        # Fim de bloco: avisar dá a sensação de progresso em vez de interrogatório.
        if QUESTIONS[proximo].step != QUESTIONS[idx].step:
            aviso = (f"✅ Bloco _{ROTULO_DO_BLOCO.get(QUESTIONS[idx].step, '')}_ "
                     "respondido.\n\n")
        return aviso + _render(proximo)

    faltando = missing_answers(respostas)
    if faltando:
        # Não deveria acontecer (o fluxo é sequencial), mas se acontecer é melhor
        # voltar para a pergunta que falta do que salvar um perfil incompleto.
        alvo = next(i for i, q in enumerate(QUESTIONS) if q.key == faltando[0])
        store.gravar_sessao(numero, {"fluxo": "onboarding", "idx": alvo,
                                     "respostas": respostas}, store.TTL_FLUXO)
        return "Faltou esta:\n\n" + _render(alvo)

    perfil = build_profile(respostas)
    store.gravar_sessao(numero, {"fluxo": "confirmacao", "etapa": "onboarding",
                                 "respostas": respostas}, store.TTL_FLUXO)
    return _resumo(perfil)


def gravar(numero: str, respostas: dict[str, Any]) -> str:
    """Chamado depois do "sim" no resumo. É o único ponto que escreve o perfil."""
    if not respostas:
        return "Perdi suas respostas. Manda */onboarding* para recomeçar."

    perfil = build_profile(respostas)
    repo.salvar_perfil(respostas, perfil.to_dict())

    linhas = [
        f"Perfil salvo. ✅ Você é *{perfil.profile}* "
        f"(score {perfil.risk_score:.0f}/100).",
        "",
    ]
    if perfil.is_blocked:
        bloqueio = next(p for p in perfil.prerequisites if p.blocking)
        linhas += [f"*Antes de investir em bolsa:* {bloqueio.title}", ""]
    linhas.append("Manda */alocacao* para ver a alocação-alvo, ou */sugestao* "
                  "para eu montar uma carteira com dados de mercado de hoje.")
    return "\n".join(linhas)


# --- Renderização -----------------------------------------------------------
def _render(idx: int, com_ajuda: bool = False) -> str:
    pergunta = QUESTIONS[idx]
    bloco = ROTULO_DO_BLOCO.get(pergunta.step, "")
    linhas = [f"_{idx + 1}/{TOTAL} · {bloco}_", f"*{pergunta.prompt}*"]

    if pergunta.help and (com_ajuda or pergunta.kind in ("scale", "number")):
        linhas.append(f"_{pergunta.help}_")

    if pergunta.kind in ("choice", "multi"):
        linhas.append("")
        linhas += [f"{i}. {c.label}" for i, c in enumerate(pergunta.choices, 1)]
        if pergunta.kind == "multi":
            linhas.append("")
            linhas.append("_Pode marcar vários: responda os números separados por "
                          "vírgula (ex: 2,4). Ou *0* se nenhum._")
    elif pergunta.kind == "scale":
        linhas.append("")
        linhas.append(f"_Responda um número de {pergunta.min_value:.0f} a "
                      f"{pergunta.max_value:.0f}._")
    elif pergunta.kind == "number":
        linhas.append("")
        linhas.append("_Responda o valor em reais (ex: 3500 ou 3.500,00)._")

    return "\n".join(linhas)


def _ler_resposta(pergunta: Question, bruto: str) -> tuple[Any, str]:
    """Texto do usuário → valor da resposta, ou `(None, motivo)`."""
    if not bruto:
        return None, "Não veio nada."

    if pergunta.kind == "choice":
        escolha = _por_indice(pergunta, bruto)
        if escolha:
            return escolha, ""
        return None, (f"Responda com um número de 1 a {len(pergunta.choices)}.")

    if pergunta.kind == "multi":
        valores: list[str] = []
        for parte in bruto.replace(" ", ",").split(","):
            if not parte.strip():
                continue
            escolha = _por_indice(pergunta, parte)
            if not escolha:
                return None, (f'Não reconheci "{parte.strip()}". Use números de 1 a '
                              f"{len(pergunta.choices)}, separados por vírgula.")
            if escolha not in valores:
                valores.append(escolha)
        if not valores:
            return None, (f"Responda os números separados por vírgula, ou *0* "
                          "se nunca investiu em nenhum.")
        return valores, ""

    valor = parse_number_br(bruto)
    if valor is None:
        return None, "Preciso de um número aqui."

    if pergunta.kind == "scale":
        inteiro = round(valor)
        if not pergunta.min_value <= inteiro <= pergunta.max_value:
            return None, (f"A nota vai de {pergunta.min_value:.0f} a "
                          f"{pergunta.max_value:.0f}.")
        return inteiro, ""

    if valor < pergunta.min_value:
        return None, f"O valor não pode ser menor que {money(pergunta.min_value)}."
    if valor > pergunta.max_value:
        return None, (f"{money(valor)}? Isso passa do limite que eu aceito aqui "
                      f"({money(pergunta.max_value)}).")
    return valor, ""


def _por_indice(pergunta: Question, bruto: str) -> str | None:
    """`"2"` → o `value` da segunda opção. Aceita também o texto da opção."""
    texto = bruto.strip().lower()
    indice = parse_number_br(texto)
    if indice is not None and float(indice).is_integer():
        posicao = int(indice)
        if 1 <= posicao <= len(pergunta.choices):
            return pergunta.choices[posicao - 1].value
        return None
    # Alguém pode responder escrevendo a opção; aceitar é mais gentil que recusar.
    for escolha in pergunta.choices:
        if texto == escolha.value or texto == escolha.label.lower():
            return escolha.value
    return None


def _resumo(perfil: Any) -> str:
    """O resumo que o usuário confirma antes de o perfil ser gravado."""
    linhas = [
        "*Terminamos.* Isto é o que suas respostas dizem:",
        "",
        f"Perfil: *{perfil.profile}* (score {perfil.risk_score:.0f}/100)",
        f"Horizonte: {perfil.horizon_years:.0f} anos · aporte "
        f"{money(perfil.monthly_contribution)}/mês",
    ]
    if perfil.emergency_target:
        linhas.append(
            f"Reserva: {money(perfil.emergency_current)} de "
            f"{money(perfil.emergency_target)}"
            + (f" — faltam {money(perfil.emergency_gap)}" if perfil.emergency_gap else " ✅"))

    alocacao = " · ".join(f"{k}: {percent(v, signed=False)}"
                          for k, v in perfil.allocation.items() if v)
    linhas.append(f"Alocação-alvo: {alocacao}")
    linhas.append(f"Disponível para investir agora: {money(perfil.investable_amount)}")

    bloqueios = [p for p in perfil.prerequisites if p.blocking]
    if bloqueios:
        linhas += ["", "*Antes de tudo:*"]
        linhas += [f"- {p.title}" for p in bloqueios]

    for nota in perfil.notes[:2]:
        linhas += ["", f"_{nota}_"]

    linhas += ["", "Salvo assim? Responda *sim* para gravar ou *não* para descartar."]
    return "\n".join(linhas)
