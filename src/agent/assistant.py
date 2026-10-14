"""O assistente: laço de conversa do Claude com as ferramentas do InvestAI.

Usa o Tool Runner do SDK (`client.beta.messages.tool_runner`), que executa o
ciclo pedido → ferramenta → resposta sem laço manual. Três cuidados que o
runner não resolve sozinho e são responsabilidade daqui:

1. **Histórico** — o runner mantém cópia interna e não a expõe; espelhamos as
   mensagens para persistir a conversa entre mensagens do WhatsApp.
2. **Teto de gasto** — cada resposta consome créditos; sem limite, uma conversa
   em laço esvazia a conta.
3. **Fronteira de erro** — qualquer falha vira uma frase em português, nunca um
   traceback na tela do celular.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from src.agent.tools import FERRAMENTAS
from src.config import LLM_EFFORT, LLM_MODEL, LLM_TIMEOUT, anthropic_key

logger = logging.getLogger(__name__)

MAX_TOKENS = 4000          # resposta de WhatsApp: curta por natureza
MAX_ITERACOES = 8          # teto de chamadas de ferramenta por mensagem
MAX_HISTORICO = 40         # mensagens mantidas na conversa (as mais recentes)

SYSTEM_PROMPT = """Você é o InvestAI, assistente pessoal de investimentos do usuário, falando com ele pelo WhatsApp.

COMO RESPONDER
- Português do Brasil, direto e claro. Sem jargão desnecessário.
- Mensagem de celular: vá ao ponto. Respostas de 2 a 8 linhas na maioria dos casos.
- Nada de markdown pesado: o WhatsApp não renderiza tabela, título com # nem link em colchetes.
  Use *negrito* do WhatsApp com moderação, listas com "-" e quebras de linha.
- Números em formato brasileiro (R$ 1.234,56 e 12,5%).

COMO PENSAR
- Use as ferramentas para buscar dado real. Nunca invente preço, indicador ou notícia,
  e nunca responda de memória sobre valores de mercado — eles mudam todo dia.
- Cite o dado que embasou cada conclusão ("RSI em 74, acima de 70").
- Quando um dado não estiver disponível, diga isso em vez de estimar.
- Seja honesto sobre incerteza. Nunca prometa retorno nem garanta direção de preço.
- Você informa e explica; a decisão é do usuário. Não é recomendação formal de investimento.

ECONOMIA DE CHAMADAS
- `gerar_briefing` é cara e demora cerca de um minuto: use só quando pedirem o briefing
  ou uma análise completa da carteira. Para perguntas pontuais, use as ferramentas específicas.
- Não chame a mesma ferramenta duas vezes para a mesma pergunta.
"""


@dataclass
class Resposta:
    """O que o servidor precisa saber depois de processar uma mensagem."""

    texto: str = ""
    historico: list[dict[str, Any]] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    ferramentas_usadas: list[str] = field(default_factory=list)
    erro: str | None = None

    @property
    def ok(self) -> bool:
        return bool(self.texto) and self.erro is None

    @property
    def custo_estimado(self) -> float:
        """Custo em dólares — Opus 5: US$ 5/M entrada, US$ 25/M saída.

        São três preços diferentes de entrada, e esquecer um deles subestima a
        conta: ler do cache custa 10% da entrada normal, mas **escrever** custa
        125%. A primeira mensagem de uma conversa escreve ~4 mil tokens de
        ferramentas e system prompt — é a mensagem mais cara, não a mais barata.
        """
        return (
            self.input_tokens / 1e6 * 5
            + self.cache_read_tokens / 1e6 * 0.5
            + self.cache_write_tokens / 1e6 * 6.25
            + self.output_tokens / 1e6 * 25
        )


def _extrair_texto(message: Any) -> str:
    return "\n".join(b.text for b in message.content if b.type == "text").strip()


def _aparar(historico: list[dict[str, Any]], maximo: int = MAX_HISTORICO) -> list[dict[str, Any]]:
    """Mantém as mensagens mais recentes, sem cortar no meio de um par de ferramentas.

    Uma mensagem com `tool_use` precisa ser seguida pelo `tool_result`
    correspondente; cortar entre os dois faz a API recusar a requisição.
    """
    if len(historico) <= maximo:
        return historico

    def eh_turno_limpo(mensagem: dict[str, Any]) -> bool:
        """Mensagem do usuário que NÃO é resultado de ferramenta.

        É o único ponto seguro para começar: um `tool_result` sem o `tool_use`
        correspondente faz a API recusar a requisição inteira.
        """
        if mensagem.get("role") != "user":
            return False
        conteudo = mensagem.get("content")
        if not isinstance(conteudo, list):
            return True  # texto puro
        return not any(
            (getattr(b, "type", None) == "tool_result")
            or (isinstance(b, dict) and b.get("type") == "tool_result")
            for b in conteudo
        )

    for corte in range(len(historico) - maximo, len(historico)):
        if eh_turno_limpo(historico[corte]):
            return historico[corte:]

    # Nenhuma fronteira segura na cauda: recomeça a conversa em vez de enviar
    # um histórico inválido. Perder contexto é ruim; quebrar a requisição é pior.
    logger.info("Histórico sem fronteira segura para podar — reiniciando a conversa")
    return []


def responder(
    mensagem: str,
    historico: list[dict[str, Any]] | None = None,
    model: str = LLM_MODEL,
    on_tool: Callable[[str], None] | None = None,
) -> Resposta:
    """Processa uma mensagem do usuário e devolve a resposta do assistente.

    `historico` é a conversa anterior (como devolvida em `Resposta.historico`).
    `on_tool` é chamado com o nome de cada ferramenta usada — serve para avisar
    "consultando sua carteira…" enquanto a resposta não vem.
    """
    texto = (mensagem or "").strip()
    if not texto:
        return Resposta(erro="mensagem vazia")

    if not anthropic_key():
        return Resposta(erro="ANTHROPIC_API_KEY não configurada no servidor.")

    try:
        import anthropic
    except ImportError:
        return Resposta(erro="Pacote `anthropic` não instalado.")

    mensagens = _aparar(list(historico or []))
    mensagens.append({"role": "user", "content": texto})

    client = anthropic.Anthropic(timeout=LLM_TIMEOUT, max_retries=2)
    usadas: list[str] = []
    entrada = saida = cache_lido = cache_escrito = 0
    ultima = None

    try:
        runner = client.beta.messages.tool_runner(
            model=model,
            max_tokens=MAX_TOKENS,
            max_iterations=MAX_ITERACOES,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": LLM_EFFORT},
            # As definições das 8 ferramentas + system prompt somam ~4 mil tokens
            # reenviados a cada mensagem. Como esse prefixo é estável, cacheá-lo
            # derruba o custo da conversa em cerca de 90%.
            cache_control={"type": "ephemeral"},
            tools=FERRAMENTAS,
            messages=mensagens,
        )

        for message in runner:
            ultima = message
            entrada += getattr(message.usage, "input_tokens", 0) or 0
            saida += getattr(message.usage, "output_tokens", 0) or 0
            cache_lido += getattr(message.usage, "cache_read_input_tokens", 0) or 0
            cache_escrito += getattr(message.usage, "cache_creation_input_tokens", 0) or 0

            # Espelha o histórico: o runner guarda o dele e não o expõe.
            mensagens.append({"role": "assistant", "content": message.content})

            for bloco in message.content:
                if bloco.type == "tool_use":
                    usadas.append(bloco.name)
                    if on_tool:
                        try:
                            on_tool(bloco.name)
                        except Exception:  # noqa: BLE001 — aviso nunca derruba a resposta
                            logger.debug("callback on_tool falhou", exc_info=True)

            resultado = runner.generate_tool_call_response()
            if resultado is not None:
                mensagens.append(resultado)

    except anthropic.AuthenticationError:
        return Resposta(erro="Chave da Anthropic inválida ou sem permissão.")
    except anthropic.RateLimitError:
        return Resposta(erro="Limite de requisições da API atingido. Tente de novo em alguns minutos.")
    except anthropic.APITimeoutError:
        return Resposta(erro=f"A resposta passou de {LLM_TIMEOUT:.0f}s e foi interrompida.")
    except anthropic.APIConnectionError:
        return Resposta(erro="Não consegui falar com a API da Anthropic. Verifique a conexão do servidor.")
    except anthropic.APIStatusError as exc:
        return Resposta(erro=f"A API recusou a requisição (HTTP {exc.status_code}).")
    except Exception as exc:  # noqa: BLE001 — fronteira: nada vaza para o usuário
        logger.exception("Falha inesperada no assistente")
        return Resposta(erro=f"Falha inesperada: {exc.__class__.__name__}")

    if ultima is None:
        return Resposta(erro="A API não devolveu resposta.")

    if ultima.stop_reason == "refusal":
        return Resposta(erro="O modelo recusou a requisição por política de conteúdo.",
                        input_tokens=entrada, output_tokens=saida,
                        cache_read_tokens=cache_lido, cache_write_tokens=cache_escrito)

    resposta = _extrair_texto(ultima)
    if not resposta:
        # Fim do laço sem texto: normalmente o teto de iterações foi atingido.
        resposta = ("Consultei os dados mas não consegui fechar a resposta. "
                    "Tente perguntar de forma mais específica.")

    return Resposta(
        texto=resposta,
        historico=_aparar(mensagens),
        input_tokens=entrada,
        output_tokens=saida,
        cache_read_tokens=cache_lido,
        cache_write_tokens=cache_escrito,
        ferramentas_usadas=usadas,
    )


#: Mensagens que não precisam de modelo nenhum: a resposta é sempre a mesma.
#: Custam zero e respondem na hora, em vez de gastar ~US$ 0,03 para dizer "oi".
SAUDACOES = frozenset({
    "oi", "ola", "olá", "oie", "eai", "e aí", "e ai", "opa", "fala",
    "bom dia", "boa tarde", "boa noite", "oi!", "olá!", "ola!",
    "tudo bem?", "tudo bem", "beleza?", "beleza",
})

AGRADECIMENTOS = frozenset({
    "obrigado", "obrigada", "valeu", "vlw", "brigado", "show", "massa",
    "perfeito", "legal", "top", "ok", "okay", "blz", "👍", "🙏",
})


def resposta_rapida(mensagem: str) -> str | None:
    """Resposta local para mensagens triviais. `None` = precisa do modelo.

    Só casa a mensagem **inteira**: "bom dia" responde daqui, mas
    "bom dia, como está minha carteira?" vai para o modelo normalmente.
    """
    texto = (mensagem or "").strip().lower().rstrip("!.")
    if texto in SAUDACOES:
        return saudacao()
    if texto in AGRADECIMENTOS:
        return "Por nada! 👊 Quando quiser, é só chamar."
    return None


def saudacao() -> str:
    """Mensagem de boas-vindas, enviada no primeiro contato."""
    return (
        "Opa! Sou o *InvestAI*, seu assistente de investimentos.\n\n"
        "Posso te ajudar com:\n"
        "- *Carteira*: \"como está minha carteira?\"\n"
        "- *Ativos*: \"analisa PETR4\" ou \"cotação de VALE3 e ITUB4\"\n"
        "- *Notícias*: \"o que saiu sobre meus ativos?\"\n"
        "- *Briefing*: \"me manda o briefing da semana\"\n"
        "- *Perfil*: \"qual meu perfil?\" ou \"o que eu deveria comprar?\"\n\n"
        "Pode perguntar do seu jeito — eu entendo."
    )
