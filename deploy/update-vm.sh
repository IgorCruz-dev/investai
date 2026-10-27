#!/usr/bin/env bash
# Atualiza a VM com o código local e reinicia os serviços.
#
#   bash deploy/update-vm.sh            # envia, instala e reinicia
#   VM=ubuntu@1.2.3.4 bash deploy/update-vm.sh
#
# Não toca no .env da VM nem na sessão do WhatsApp: os dois ficam de fora do
# rsync de propósito. Perder `apps/bridge/auth_session` significa parear o QR de novo.
set -euo pipefail
cd "$(dirname "$0")/.."

VM="${VM:-ubuntu@SEU_IP_DA_VM}"
DESTINO="${DESTINO:-~/investai/}"

echo "==> Enviando código para $VM"
rsync -az --delete \
  --exclude .venv --exclude .git --exclude cache --exclude .env \
  --exclude node_modules --exclude auth_session --exclude __pycache__ \
  --exclude '.pytest_cache' \
  ./ "$VM:$DESTINO"

echo "==> Dependências e verificação"
ssh "$VM" "cd ~/investai \
  && .venv/bin/pip install -q -e . \
  && .venv/bin/python -c 'from investai.whatsapp.app import app; print(\"    servidor importa\")' \
  && .venv/bin/python -c 'from investai.data import repo; print(\"    banco:\", \"configurado\" if repo.configurado() else \"SEM DATABASE_URL\")'"

echo "==> Reiniciando serviços"
ssh "$VM" "sudo systemctl restart investai && sleep 3 && curl -sf localhost:8000/health" | head -c 400
echo
echo "==> Pronto. Logs: ssh $VM 'sudo journalctl -u investai -f'"
