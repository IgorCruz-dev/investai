#!/usr/bin/env bash
# Baixa o QR mais recente da VM e abre. O código expira a cada ~40s e a ponte
# gera outro — é só rodar de novo se perder o tempo.
IP=SEU_IP_DA_VM
scp -q ubuntu@$IP:~/investai/bridge/qr.png ~/qr-investai.png 2>/dev/null \
  && { echo "QR atualizado: ~/qr-investai.png"; xdg-open ~/qr-investai.png 2>/dev/null & } \
  || echo "Sem QR na VM — provavelmente já está conectado. Confira: ssh ubuntu@$IP 'curl -s localhost:8000/health'"
