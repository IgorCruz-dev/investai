"""Testes do wizard de primeiro acesso.

O wizard é interativo, então o que se testa aqui é o que ele faz com arquivo e
com senha — a parte onde um erro é silencioso e caro: sobrescrever o `.env` de
alguém, duplicar chave, ou gerar um hash que o login da web não valida.
"""

from __future__ import annotations

import base64
import hashlib

import pytest

from investai import setup, tenants


@pytest.fixture
def env_falso(tmp_path, monkeypatch):
    """Aponta o wizard para um `.env` de teste, longe do `.env` de verdade."""
    env = tmp_path / ".env"
    exemplo = tmp_path / ".env.example"
    exemplo.write_text("# exemplo\nANTHROPIC_API_KEY=sua_chave_aqui\n", encoding="utf-8")
    monkeypatch.setattr(setup, "ENV_PATH", env)
    monkeypatch.setattr(setup, "ENV_EXEMPLO", exemplo)
    return env


# --- .env -------------------------------------------------------------------
def test_cria_o_env_a_partir_do_exemplo(env_falso):
    assert not env_falso.exists()
    setup.gravar_env({"DATABASE_URL": "postgresql://x"})
    conteudo = env_falso.read_text(encoding="utf-8")
    assert "# exemplo" in conteudo, "o .env.example é a base, com os comentários"
    assert "DATABASE_URL=postgresql://x" in conteudo


def test_reescreve_a_linha_existente_em_vez_de_duplicar(env_falso):
    """Duas linhas com a mesma chave fariam a última ganhar em silêncio."""
    env_falso.write_text(
        "# comentário que deve sobreviver\nDATABASE_URL=postgresql://antiga\nOUTRA=1\n",
        encoding="utf-8",
    )
    setup.gravar_env({"DATABASE_URL": "postgresql://nova"})

    linhas = env_falso.read_text(encoding="utf-8").splitlines()
    assert linhas.count("DATABASE_URL=postgresql://nova") == 1
    assert not [x for x in linhas if "postgresql://antiga" in x]
    assert "# comentário que deve sobreviver" in linhas
    assert "OUTRA=1" in linhas


def test_descomenta_a_chave_que_estava_comentada(env_falso):
    """No .env.example as opcionais vêm comentadas; responder tem de ativá-las."""
    env_falso.write_text("# INVESTAI_TENANT_ID=\n", encoding="utf-8")
    setup.gravar_env({"INVESTAI_TENANT_ID": "kaua"})
    assert "INVESTAI_TENANT_ID=kaua" in env_falso.read_text(encoding="utf-8").splitlines()


def test_acrescenta_a_chave_que_nao_existia(env_falso):
    env_falso.write_text("OUTRA=1\n", encoding="utf-8")
    setup.gravar_env({"NOVA": "2"})
    conteudo = env_falso.read_text(encoding="utf-8")
    assert "OUTRA=1" in conteudo
    assert "NOVA=2" in conteudo


def test_env_fica_com_permissao_restrita(env_falso):
    """Tem chave de API e senha de banco: 600, não 644."""
    setup.gravar_env({"DATABASE_URL": "postgresql://x"})
    assert oct(env_falso.stat().st_mode)[-3:] == "600"


def test_ler_env_ignora_comentario_e_linha_vazia(env_falso):
    env_falso.write_text("# comentário\n\nA=1\n# B=2\nC=3\n", encoding="utf-8")
    assert setup.ler_env() == {"A": "1", "C": "3"}


# --- Validações das respostas ----------------------------------------------
@pytest.mark.parametrize("valor,valido", [
    ("postgresql://u:s@host/db", True),
    ("postgres://u:s@host/db", True),
    ("mysql://u:s@host/db", False),
    ("ep-xxx.neon.tech", False),
])
def test_valida_postgres(valor, valido):
    assert (setup._valida_postgres(valor) is None) is valido


@pytest.mark.parametrize("valor,valido", [
    ("5516991234567", True),
    ("+55 (16) 99123-4567", True),
    ("991234567", False),
    ("abc", False),
])
def test_valida_telefone(valor, valido):
    assert (setup._valida_telefone(valor) is None) is valido


@pytest.mark.parametrize("valor,valido", [
    ("sk-ant-api03-xxx", True),
    ("minha-chave", False),
])
def test_valida_chave(valor, valido):
    assert (setup._valida_chave(valor) is None) is valido


def test_resumir_nao_despeja_connection_string_na_tela():
    longa = "postgresql://usuario:senha-secreta@ep-xxx.neon.tech/neondb"
    resumo = setup._resumir(longa)
    assert "senha-secreta" not in resumo
    assert len(resumo) < len(longa)


# --- Senha ------------------------------------------------------------------
def test_hash_tem_o_formato_que_o_login_da_web_espera():
    h = tenants.hash_de_senha("uma-senha-bem-longa")
    algoritmo, iteracoes, salt, derivado = h.split("$")
    assert algoritmo == "pbkdf2"
    assert int(iteracoes) == tenants.PBKDF2_ITERACOES
    assert len(base64.b64decode(salt)) == 16
    assert len(base64.b64decode(derivado)) == 32, "o JS deriva 256 bits"


def test_hash_confere_pelo_mesmo_caminho_do_javascript():
    """Reproduz o que `senhaConfere()` faz em apps/web/api/_auth.js.

    Se este teste quebrar, ninguém consegue entrar no painel com a senha que o
    wizard cadastrou — e o sintoma seria "senha incorreta" sem explicação.
    """
    senha = "uma-senha-bem-longa"
    _, iteracoes, salt, esperado = tenants.hash_de_senha(senha).split("$")
    derivado = hashlib.pbkdf2_hmac(
        "sha256", senha.encode("utf-8"), base64.b64decode(salt), int(iteracoes), 32
    )
    assert base64.b64encode(derivado).decode() == esperado


def test_salt_e_aleatorio_por_senha():
    a = tenants.hash_de_senha("uma-senha-bem-longa")
    b = tenants.hash_de_senha("uma-senha-bem-longa")
    assert a != b, "salt fixo deixaria o hash igual para senhas iguais"


def test_senha_curta_e_recusada():
    with pytest.raises(ValueError, match="12 caracteres"):
        tenants.hash_de_senha("curta")
