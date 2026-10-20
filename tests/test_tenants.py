"""Testes do registro de usuários e do isolamento entre eles.

O que importa aqui não é o parsing do JSON — é a garantia de que a query de uma
pessoa nunca sai no banco de outra. Dois testes cuidam disso: o do `ContextVar`
sob concorrência (que falharia com uma global) e o do pool por tenant.
"""

from __future__ import annotations

import json
import re
import threading

import pytest

from investai import tenants

REGISTRO = [
    {
        "id": "igor",
        "nome": "Igor",
        "telefone": "5516900000001",
        "database_url": "postgresql://u:s@igor.neon.tech/db",
        "database_url_pooled": "postgresql://u:s@igor-pooler.neon.tech/db",
        "anthropic_key": "sk-ant-do-igor",
        "web_password_hash": "pbkdf2$1$a$b",
        "budget_usd": 7,
    },
    {
        "id": "kaua",
        "nome": "Kaua",
        "telefone": "5516900000002",
        "database_url": "postgresql://u:s@kaua.neon.tech/db",
        "anthropic_key": "sk-ant-do-kaua",
        "budget_usd": 3,
    },
]


@pytest.fixture
def registro(monkeypatch):
    """Registro de dois usuários, vindo da variável de ambiente."""
    monkeypatch.setenv("INVESTAI_TENANTS", json.dumps(REGISTRO))
    tenants.recarregar()
    yield tenants
    tenants.recarregar()


@pytest.fixture
def sem_registro(monkeypatch):
    """Modo de uma pessoa: o que roda hoje na VM do Igor."""
    monkeypatch.delenv("INVESTAI_TENANTS", raising=False)
    monkeypatch.setattr(tenants, "REGISTRO_PATH", tenants.ROOT / "config" / "nao-existe.json")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:s@pessoal.neon.tech/db")
    monkeypatch.setenv("WHATSAPP_ALLOWED_NUMBERS", "5516900000009")
    tenants.recarregar()
    yield tenants
    tenants.recarregar()


# --- Carregamento -----------------------------------------------------------
def test_registro_carrega_e_indexa_por_telefone_e_por_id(registro):
    assert registro.multiusuario() is True
    assert [t.id for t in registro.todos()] == ["igor", "kaua"]

    kaua = registro.por_telefone("5516900000002")
    assert kaua is not None and kaua.id == "kaua"
    assert kaua.budget_usd == 3
    # O pooler cai no endpoint direto quando não é informado.
    assert kaua.database_url_pooled == kaua.database_url
    assert registro.por_id("IGOR").nome == "Igor", "o id não pode ser sensível a caixa"


def test_telefone_e_normalizado_para_digitos(registro):
    assert registro.por_telefone("+55 (16) 90000-0002").id == "kaua"
    assert registro.por_telefone("") is None
    assert registro.por_telefone("5516999999999") is None


def test_lista_branca_em_multiusuario_e_o_registro(registro):
    assert registro.telefones_autorizados() == {"5516900000001", "5516900000002"}


def test_sem_registro_opera_como_instancia_pessoal(sem_registro):
    assert sem_registro.multiusuario() is False
    assert sem_registro.telefones_autorizados() == {"5516900000009"}
    unico = sem_registro.ativo_ou_padrao()
    assert unico.id == tenants.ID_PADRAO
    assert unico.database_url == "postgresql://u:s@pessoal.neon.tech/db"
    assert unico.anthropic_key is None, "a instância pessoal usa a chave do .env"


# --- Validação: erro de configuração é melhor que vazamento silencioso ------
def test_telefone_duplicado_recusa_o_registro(monkeypatch):
    duplicado = [dict(REGISTRO[0]), dict(REGISTRO[1], telefone=REGISTRO[0]["telefone"])]
    monkeypatch.setenv("INVESTAI_TENANTS", json.dumps(duplicado))
    tenants.recarregar()
    with pytest.raises(tenants.RegistroInvalido, match="mesmo de"):
        tenants.registro()
    tenants.recarregar()


def test_id_duplicado_recusa_o_registro(monkeypatch):
    monkeypatch.setenv("INVESTAI_TENANTS", json.dumps([REGISTRO[0], dict(REGISTRO[0])]))
    tenants.recarregar()
    with pytest.raises(tenants.RegistroInvalido, match="duas vezes"):
        tenants.registro()
    tenants.recarregar()


def test_chave_da_anthropic_e_obrigatoria_no_registro(monkeypatch):
    """Cada um traz a sua: sem chave, o uso sairia do crédito de quem hospeda."""
    sem_chave = [dict(REGISTRO[0], anthropic_key="")]
    monkeypatch.setenv("INVESTAI_TENANTS", json.dumps(sem_chave))
    tenants.recarregar()
    with pytest.raises(tenants.RegistroInvalido, match="anthropic_key"):
        tenants.registro()
    tenants.recarregar()


@pytest.mark.parametrize("ident", ["com.ponto", "COM MAIÚSCULA E ESPAÇO", "-comeca-com-hifen",
                                   "a" * 33, "acento-ç", ""])
def test_id_fora_do_conjunto_permitido_recusa(monkeypatch, ident):
    """O id entra no cookie (`usuario.prazo.assinatura`).

    Um ponto no id quebraria a separação da assinatura; o resto do conjunto é
    fechado para o id não virar surpresa em log nem em nome de pool.
    """
    monkeypatch.setenv("INVESTAI_TENANTS", json.dumps([dict(REGISTRO[0], id=ident)]))
    tenants.recarregar()
    with pytest.raises(tenants.RegistroInvalido):
        tenants.registro()
    tenants.recarregar()


def test_json_invalido_recusa_em_vez_de_ignorar(monkeypatch):
    monkeypatch.setenv("INVESTAI_TENANTS", "{isso não é json}")
    tenants.recarregar()
    with pytest.raises(tenants.RegistroInvalido, match="JSON"):
        tenants.registro()
    tenants.recarregar()


def test_sem_usuario_ativo_em_multiusuario_e_erro(registro):
    """Cair num tenant arbitrário seria pior que falhar."""
    with pytest.raises(tenants.RegistroInvalido, match="nenhum usuário ativo"):
        registro.ativo_ou_padrao()


def test_o_modulo_carrega_o_env_no_import():
    """Regressão: os crons importam `tenants` antes de qualquer coisa de config.

    `config` era o único a chamar `load_dotenv()`, então um cron que importasse
    só `tenants` montava o tenant do modo pessoal com `database_url` vazia — e
    morria com "DATABASE_URL não configurada" numa instalação correta.

    O subprocesso importa **apenas** `investai.tenants`, reproduzindo essa
    ordem. Sem `.env` no ambiente não há o que verificar (é o caso do CI), e aí
    o teste pula com o motivo, como o resto da suíte faz com recurso ausente.
    """
    import subprocess
    import sys

    env_path = tenants.ROOT / ".env"
    if not env_path.exists():
        pytest.skip(".env não existe neste ambiente")
    if not re.search(r"(?m)^DATABASE_URL=\S", env_path.read_text(encoding="utf-8")):
        pytest.skip(".env não define DATABASE_URL")

    saida = subprocess.run(
        [sys.executable, "-c",
         "from investai import tenants; print(bool(tenants.todos()[0].database_url))"],
        capture_output=True, text=True, timeout=60,
    )
    assert saida.returncode == 0, saida.stderr
    assert saida.stdout.strip() == "True", (
        "importar só `tenants` tem de enxergar a DATABASE_URL do .env — "
        "senão os crons quebram em modo pessoal"
    )


# --- Modo pessoal não pode mudar de comportamento -------------------------
def test_modo_pessoal_nao_abre_escopo_por_telefone(sem_registro):
    """Regressão: o tenant sintético não pode virar escopo ativo.

    `por_telefone()` devolvia o tenant do `.env` quando o número batia com a
    `WHATSAPP_ALLOWED_NUMBERS`. Com um escopo aberto nele, `anthropic_key()`
    lia `tenant.anthropic_key` (que é `None` no sintético) em vez do `.env` — e
    as rotas de IA passavam a dizer "chave não configurada" numa instalação
    pessoal que funcionava.
    """
    assert sem_registro.por_telefone("5516900000009") is None


def test_modo_pessoal_le_chave_e_banco_do_env_mesmo_dentro_de_escopo(
    sem_registro, monkeypatch
):
    """É o caminho dos crons: `tenants.todos()` + `usar()` em modo pessoal."""
    from investai import config
    from investai.data import repo

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-a-do-dono-da-vm")

    unico = sem_registro.todos()[0]
    with sem_registro.usar(unico):
        assert config.anthropic_key() == "sk-ant-a-do-dono-da-vm"
        assert repo.url() == "postgresql://u:s@pessoal.neon.tech/db"


# --- Isolamento -------------------------------------------------------------
def test_usar_define_e_devolve_o_escopo(registro):
    assert registro.ativo() is None
    igor = registro.por_id("igor")
    with registro.usar(igor):
        assert registro.ativo() is igor
        assert registro.ativo_ou_padrao() is igor
    assert registro.ativo() is None, "o escopo não pode vazar do bloco"


def test_a_chave_da_anthropic_segue_o_usuario_ativo(registro, monkeypatch):
    from investai import config

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-de-quem-hospeda")

    with registro.usar(registro.por_id("igor")):
        assert config.anthropic_key() == "sk-ant-do-igor"
    with registro.usar(registro.por_id("kaua")):
        assert config.anthropic_key() == "sk-ant-do-kaua"
    # Fora de um escopo, a chave do .env — é a instância pessoal.
    assert config.anthropic_key() == "sk-ant-de-quem-hospeda"


def test_usuario_sem_chave_nao_cai_na_chave_de_quem_hospeda(registro, monkeypatch):
    """O `return None` do `anthropic_key()` é o ponto de aplicação da regra.

    Um registro validado nunca tem tenant sem chave, mas a construção direta
    simula o que aconteceria se alguém contornasse a validação: a rota de IA
    precisa dizer "não configurada", nunca gastar o crédito de outra pessoa.
    """
    from investai import config

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-de-quem-hospeda")
    sem_chave = tenants.Tenant(
        id="sem", nome="Sem", telefone="5516900000003",
        database_url="postgresql://u:s@sem.neon.tech/db",
        database_url_pooled="postgresql://u:s@sem.neon.tech/db",
        anthropic_key=None, budget_usd=1,
    )
    with registro.usar(sem_chave):
        assert config.anthropic_key() is None


def test_a_url_do_banco_segue_o_usuario_ativo(registro):
    from investai.data import repo

    with registro.usar(registro.por_id("igor")):
        assert repo.url() == "postgresql://u:s@igor.neon.tech/db"
    with registro.usar(registro.por_id("kaua")):
        assert repo.url() == "postgresql://u:s@kaua.neon.tech/db"


def test_sem_escopo_em_multiusuario_nao_devolve_banco_nenhum(registro):
    """Sem isso, uma operação fora de escopo iria para o banco do .env."""
    from investai.data import repo

    assert repo.url() is None


def test_pool_e_por_usuario_nunca_compartilhado(registro, monkeypatch):
    """Cada banco tem o seu pool, e trocar de usuário não reaproveita o do outro."""
    from investai.data import repo

    criados: list[str] = []

    def fake_pool():
        criados.append(repo.url() or "")
        return object()

    monkeypatch.setattr(repo, "_criar_pool", fake_pool)
    repo.reset_pool()

    with registro.usar(registro.por_id("igor")):
        primeiro = repo.pool()
        assert repo.pool() is primeiro, "o pool do mesmo usuário é reaproveitado"
    with registro.usar(registro.por_id("kaua")):
        segundo = repo.pool()

    assert primeiro is not segundo, "o pool de um usuário não pode servir o outro"
    assert criados == ["postgresql://u:s@igor.neon.tech/db",
                       "postgresql://u:s@kaua.neon.tech/db"]
    repo.reset_pool()


def test_escopo_nao_vaza_entre_threads_concorrentes(registro):
    """O teste que justifica o `ContextVar` em vez de uma global.

    Os handlers do FastAPI são `def` síncrono, então rodam num threadpool: duas
    mensagens no mesmo instante executam em threads diferentes. Com uma global,
    uma thread sobrescreveria a URL da outra no meio da operação e a query sairia
    no banco errado. Aqui cada thread fixa o seu usuário, espera as outras
    chegarem (a barreira força o entrelaçamento) e só então confere o que vê.
    """
    from investai.data import repo

    pessoas = [registro.por_id("igor"), registro.por_id("kaua")] * 8
    barreira = threading.Barrier(len(pessoas))
    erros: list[str] = []

    def trabalhar(dono):
        with registro.usar(dono):
            barreira.wait(timeout=10)  # todas dentro do próprio escopo, juntas
            if registro.ativo() is not dono:
                erros.append(f"{dono.id} viu {registro.ativo()}")
            if repo.url() != dono.database_url:
                erros.append(f"{dono.id} apontou para {repo.url()}")

    threads = [threading.Thread(target=trabalhar, args=(p,)) for p in pessoas]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=15)

    assert not erros, f"escopo vazou entre threads: {erros}"
