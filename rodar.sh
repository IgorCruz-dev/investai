#!/usr/bin/env bash
# Sobe o assistente InvestAI nesta máquina: servidor Python + ponte WhatsApp.
#
#   ./rodar.sh          sobe os dois (a ponte em primeiro plano, mostrando o QR)
#   ./rodar.sh parar    encerra os dois
set -uo pipefail
cd "$(dirname "$0")"

PY_LOG="cache/servidor.log"
porta_em_uso() { ss -ltn 2>/dev/null | grep -q ":$1 "; }
matar_porta() { ss -ltnp 2>/dev/null | awk -v p=":$1 " '$0 ~ p' | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill 2>/dev/null; }

if [ "${1:-}" = "parar" ]; then
  matar_porta 8000; matar_porta 8900
  sleep 1
  echo "Serviços encerrados."
  exit 0
fi

# --- Verificações que evitam um debug chato depois ---------------------------
if grep -q "SEU_NUMERO_PESSOAL" .env bridge/.env 2>/dev/null; then
  echo "❌ Falta configurar o seu número pessoal."
  echo
  echo "   Troque SEU_NUMERO_PESSOAL pelo seu número (só dígitos, com DDI e DDD)"
  echo "   nos dois arquivos:  .env  e  bridge/.env"
  echo "   Exemplo para (16) 99123-4567:  WHATSAPP_ALLOWED_NUMBERS=5516991234567"
  echo
  echo "   É o número DE ONDE você vai mandar mensagem — não o do chip do bot."
  exit 1
fi

if ! grep -q "^ANTHROPIC_API_KEY=.\+" .env; then
  echo "❌ ANTHROPIC_API_KEY não está configurada no .env"
  exit 1
fi

if [ ! -d bridge/node_modules ]; then
  echo "==> Instalando dependências da ponte (primeira vez)"
  (cd bridge && npm install --silent)
fi

mkdir -p cache

# --- Servidor Python ---------------------------------------------------------
if porta_em_uso 8000; then
  echo "==> Servidor já está rodando na porta 8000"
else
  echo "==> Subindo o servidor Python (log em $PY_LOG)"
  .venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8000 >> "$PY_LOG" 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 \
    && echo "    servidor no ar" \
    || { echo "    ❌ servidor não subiu — veja $PY_LOG"; exit 1; }
fi

# --- Ponte WhatsApp ----------------------------------------------------------
if porta_em_uso 8900; then
  echo "==> A ponte já está rodando. Para reiniciar: ./rodar.sh parar && ./rodar.sh"
  exit 0
fi

echo "==> Subindo a ponte do WhatsApp"
echo
if [ ! -d bridge/auth_session ] || [ -z "$(ls -A bridge/auth_session 2>/dev/null)" ]; then
  echo "    Primeira vez: um QR code vai aparecer abaixo."
  echo "    No celular DO CHIP: WhatsApp → Aparelhos conectados → Conectar um aparelho"
  echo
fi
cd bridge && exec node index.js
