# Exemplos

## `briefing-exemplo.md`

Não vem no repositório: um briefing é um documento sobre **a sua** carteira, com
patrimônio e P&L reais — não é material de exemplo que se publique.

Se quiser que a interface web aberta do disco (`apps/web/index.html`) mostre a
aba de briefing preenchida, gere um e salve aqui com esse nome:

```bash
# pelo WhatsApp:  /briefing
# ou grave o snapshot local já com o briefing dentro:
.venv/bin/python scripts/export_snapshot.py --demo
```

`scripts/export_snapshot.py` injeta este arquivo no `data.js` quando ele existe,
e segue sem ele quando não existe.
