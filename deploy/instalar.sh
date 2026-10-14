#!/usr/bin/env bash
# Instalacao do InvestAI numa VM Ubuntu (Oracle Always Free).
# Uso:  bash deploy/instalar.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/investai}"
USUARIO="$(whoami)"

echo "==> Dependencias do sistema"
sudo apt-get update -qq
sudo apt-get install -y python3-venv python3-pip curl git

if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  echo "==> Node 20 LTS (o Baileys exige 20+)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "    node $(node -v) | python $(python3 -V)"

echo "==> Ambiente Python"
cd "$APP_DIR"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
.venv/bin/python -c "from server.app import app; print('    servidor importa sem erro')"

echo "==> Ponte Node"
cd "$APP_DIR/bridge"
npm install --silent
node --check index.js && echo "    ponte compila sem erro"
cd "$APP_DIR"

echo "==> Servicos systemd"
for unidade in investai investai-bridge; do
  sudo cp "deploy/$unidade.service" "/etc/systemd/system/$unidade.service"
  sudo sed -i "s|/home/ubuntu/investai|$APP_DIR|g" "/etc/systemd/system/$unidade.service"
  sudo sed -i "s|User=ubuntu|User=$USUARIO|" "/etc/systemd/system/$unidade.service"
done
sudo systemctl daemon-reload
sudo systemctl enable --now investai

echo
echo "Servidor Python no ar. Agora falta parear o WhatsApp - isto e interativo:"
echo
echo "    cd $APP_DIR/bridge && node index.js"
echo
echo "Escaneie o QR (WhatsApp -> Aparelhos conectados -> Conectar aparelho)."
echo "Quando aparecer 'Conectado ao WhatsApp', encerre com Ctrl+C e rode:"
echo
echo "    sudo systemctl enable --now investai-bridge"
echo
echo "Conferir:  curl -s localhost:8000/health"
echo "Logs:      sudo journalctl -u investai -u investai-bridge -f"
