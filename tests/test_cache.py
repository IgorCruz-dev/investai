"""Testes do cache em disco — o round-trip de DataFrame é onde bugs se esconderiam."""

from __future__ import annotations

import time

import pandas as pd

from investai.utils.cache import JsonFileCache


def _frame() -> pd.DataFrame:
    return pd.DataFrame({
        "Date": pd.to_datetime(["2026-10-07", "2026-10-08", "2026-10-09"]),
        "Open": [1.0, 2.0, 3.0],
        "High": [1.5, 2.5, 3.5],
        "Low": [0.5, 1.5, 2.5],
        "Close": [1.2, 2.2, 3.2],
        "Volume": [100, 200, 300],
    })


def test_dataframe_sobrevive_ao_round_trip(tmp_path):
    cache = JsonFileCache(tmp_path / "c.json", ttl=3600)
    cache.set("prices:X:1y", _frame())

    recuperado = cache.get("prices:X:1y")
    assert isinstance(recuperado, pd.DataFrame)
    pd.testing.assert_frame_equal(recuperado, _frame(), check_dtype=False)
    assert pd.api.types.is_datetime64_any_dtype(recuperado["Date"])


def test_entrada_expirada_devolve_none(tmp_path):
    cache = JsonFileCache(tmp_path / "c.json", ttl=0)
    cache.set("k", {"a": 1})
    time.sleep(0.01)
    assert cache.get("k") is None


def test_chave_inexistente_e_dicts(tmp_path):
    cache = JsonFileCache(tmp_path / "c.json")
    assert cache.get("nao-existe") is None

    cache.set("fundamentals:X", {"pe_ratio": 5.3, "eps": None})
    assert cache.get("fundamentals:X") == {"pe_ratio": 5.3, "eps": None}


def test_invalidate_total_e_por_prefixo(tmp_path):
    cache = JsonFileCache(tmp_path / "c.json")
    cache.set("prices:A:1y", _frame())
    cache.set("news:A:7", [{"title": "t"}])

    cache.invalidate(prefix="prices:")
    assert cache.get("prices:A:1y") is None
    assert cache.get("news:A:7") == [{"title": "t"}]

    cache.invalidate()
    assert cache.get("news:A:7") is None


def test_arquivo_corrompido_nao_derruba_o_app(tmp_path):
    path = tmp_path / "c.json"
    path.write_text("{isso não é json")
    cache = JsonFileCache(path)

    assert cache.get("qualquer") is None   # recomeça vazio, sem levantar
    cache.set("k", {"ok": True})           # e volta a funcionar
    assert cache.get("k") == {"ok": True}


def test_valor_nao_serializavel_e_descartado_sem_erro(tmp_path):
    cache = JsonFileCache(tmp_path / "c.json")
    cache.set("k", object())
    assert cache.get("k") is None


def test_age_informa_idade_da_entrada(tmp_path):
    cache = JsonFileCache(tmp_path / "c.json")
    assert cache.age("k") is None
    cache.set("k", 1)
    idade = cache.age("k")
    assert idade is not None and 0 <= idade < 5
