# Colocar o InvestAI no ar

Do zero até o assistente respondendo no seu WhatsApp. **Sem cadastro na Meta** —
a conexão é via Baileys, no mesmo número que o StudyTrack já usa.

Custo de infraestrutura: **R$ 0/mês** (Oracle Always Free). Só os créditos da
API Anthropic: ~US$ 0,006 por mensagem.

## Como funciona

```
Seu WhatsApp  →  chip do InvestAI/StudyTrack
                        ↓  (dispositivo vinculado, como o WhatsApp Web)
              ponte Baileys (Node, 127.0.0.1:8900)
                        ↓  HTTP local
              servidor InvestAI (Python, 127.0.0.1:8000)
                        ↓
              Claude + ferramentas (carteira, análise, notícias, briefing)
```

**Nada é exposto à internet.** Não há webhook, domínio, HTTPS nem porta aberta:
a ponte é um dispositivo vinculado (só conexões de saída) e os dois serviços
conversam por `127.0.0.1`.

### Conviver com o StudyTrack no mesmo número

O WhatsApp permite até 4 dispositivos vinculados, então a ponte do InvestAI
entra como um segundo aparelho, sem mexer no worker do StudyTrack. As duas
sessões recebem todas as mensagens, mas não há resposta dupla:

- o worker do StudyTrack só responde a quem tem **sessão ativa de prospecção**
  no Supabase (`hasActiveSession`) — seu número pessoal não tem;
- a ponte do InvestAI só responde aos números em `ALLOWED_NUMBERS`.

> Baileys é uma biblioteca não oficial e contraria os termos do WhatsApp — o
> mesmo risco que o StudyTrack já corre nesse chip. Como é um chip dedicado, a
> exposição é a que você já aceitou.

---

## 1. 👤 Máquina na Oracle (Always Free)

1. Crie a conta em <https://cloud.oracle.com> (pede cartão para verificação, não cobra).
2. **Compute → Instances → Create**:
   - Imagem **Ubuntu 22.04** (ou 24.04)
   - Shape **VM.Standard.A1.Flex (Ampere/ARM)**, 2 OCPU e 12 GB — dentro do Always Free
   - Salve a chave SSH
3. Não precisa liberar porta nenhuma na Security List. Nada aqui recebe conexão de fora.

> Se o cadastro for recusado ou faltar capacidade ARM na região, me avise: a
> ponte roda em qualquer Linux — inclusive no seu notebook, com a ressalva de
> que o assistente só responde com ele ligado.

---

## 2. Enviar o código e instalar

```bash
# no seu notebook
rsync -av --exclude .venv --exclude cache --exclude node_modules --exclude auth_session \
      ~/dev/investai/ ubuntu@SEU_IP:~/investai/

# na VM
ssh ubuntu@SEU_IP
cd ~/investai
cp .env.example .env                 && nano .env          # passo 3
cp bridge/.env.example bridge/.env   && nano bridge/.env   # passo 3
bash deploy/instalar.sh
```

O script instala Python, Node 20, as dependências dos dois lados, cria os
serviços no systemd e sobe o servidor Python.

---

## 3. Variáveis de ambiente

**`~/investai/.env`** (servidor Python):
```bash
ANTHROPIC_API_KEY=...                  # você já tem
BRIDGE_SECRET=uma-frase-longa-qualquer # mesma dos dois lados
WHATSAPP_ALLOWED_NUMBERS=55SEUNUMERO   # SEU número pessoal, só dígitos com DDI
INVESTAI_CRON_TOKEN=outra-frase        # protege o endpoint do briefing
INVESTAI_MONTHLY_BUDGET_USD=5          # teto de gasto com a API
```

**`~/investai/bridge/.env`** (ponte Node):
```bash
BRIDGE_SECRET=uma-frase-longa-qualquer # idêntica à de cima
ALLOWED_NUMBERS=55SEUNUMERO            # idêntico ao de cima
INVESTAI_URL=http://127.0.0.1:8000/bridge/message
```

`ALLOWED_NUMBERS` é o **seu número pessoal** — aquele de onde você vai mandar
mensagem para o chip. Sem ele, qualquer contato que escrever para o chip
conversa com o assistente gastando seus créditos.

---

## 4. Parear o WhatsApp (uma vez)

```bash
cd ~/investai/bridge && node index.js
```

Um QR code aparece no terminal. No celular: **WhatsApp (ou WhatsApp Business) do
chip → Configurações → Aparelhos conectados → Conectar um aparelho** → escaneie.

Quando o log mostrar `Conectado ao WhatsApp`, encerre com `Ctrl+C` e suba como serviço:

```bash
sudo systemctl enable --now investai-bridge
curl -s localhost:8000/health          # "ponte": {"conectado": true}
```

A sessão fica salva em `bridge/auth_session/` — não precisa parear de novo a
cada reinício. Para trocar de chip: apague a pasta e escaneie outro QR.

---

## 5. Testar

Mande "oi" do seu celular para o número do chip. Deve responder em segundos.

```
/ajuda                        → lista o que ele faz (não gasta créditos)
como está minha carteira?     → posições, valor e P&L
analisa PETR4                 → técnico + fundamentos
o que saiu sobre meus ativos? → notícias da semana
me manda o briefing           → briefing completo (~1 min)
/limpar                       → esquece a conversa
```

---

## 6. Briefing semanal

```bash
sudo timedatectl set-timezone America/Sao_Paulo
crontab -e      # cole deploy/crontab.txt e troque SEU_CRON_TOKEN
```

Domingo às 20h ele gera o briefing e manda no seu WhatsApp. Sem Cloud API não
existe janela de 24 horas nem template a aprovar: a mensagem sai direto.

---

## 7. Operação

```bash
sudo systemctl status investai investai-bridge
sudo journalctl -u investai -u investai-bridge -f     # logs ao vivo
curl -s localhost:8000/health | jq                    # gasto do mês, estado da ponte
sudo systemctl restart investai                       # após mudar o .env
```

**Atualizar o código:**
```bash
rsync -av --exclude .venv --exclude cache --exclude .env \
      --exclude node_modules --exclude auth_session \
      ~/dev/investai/ ubuntu@SEU_IP:~/investai/
ssh ubuntu@SEU_IP 'cd ~/investai && .venv/bin/pip install -q -r requirements.txt \
      && sudo systemctl restart investai investai-bridge'
```

**Backup do que importa:**
```bash
scp ubuntu@SEU_IP:~/investai/config/*.json ./backup/           # carteira e perfil
scp ubuntu@SEU_IP:~/investai/cache/investai.db ./backup/       # conversas e gastos
scp -r ubuntu@SEU_IP:~/investai/bridge/auth_session ./backup/  # sessão do WhatsApp
```

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `"conectado": false` no health | Ponte caiu ou sessão expirou | `journalctl -u investai-bridge -n 50`; se disser "Sessão encerrada", apague `auth_session/` e pareie de novo |
| Não responde nada | Seu número fora da lista branca | Confira `ALLOWED_NUMBERS` nos **dois** `.env` — só dígitos, com DDI |
| "Estou sem conexão com o servidor" | Serviço Python parado | `sudo systemctl restart investai` |
| "Atingi o limite de gasto" | Teto mensal estourado | Aumente `INVESTAI_MONTHLY_BUDGET_USD` e reinicie |
| Resposta dupla | Worker do StudyTrack respondendo também | Verifique se seu número tem sessão de prospecção ativa no Supabase |

## Segurança

- **Lista branca em dois lugares** — ponte e servidor filtram o mesmo conjunto de números.
- **Segredo compartilhado** — a ponte só aceita envios com `X-Bridge-Secret`, e o servidor só aceita mensagens com o mesmo cabeçalho.
- **Idempotência** — cada `message_id` é processado uma única vez.
- **Teto de gasto mensal** — ao atingir o limite, o assistente avisa e para de chamar a API.
- **Nada escuta na internet** — os dois serviços só aceitam conexão de `127.0.0.1`.

---

## Estado atual do deploy (14/10/2026)

| | |
|---|---|
| **VM** | `SEU_IP_DA_VM` — Oracle `sa-saopaulo-1`, `VM.Standard.E2.1.Micro` |
| **Recursos** | Ubuntu 24.04, 2 vCPU, 954 MB RAM + 3 GB swap, 45 GB disco |
| **Serviços** | `investai` (Python :8000) e `investai-bridge` (Node :8900), ambos no systemd |
| **Cron** | Briefing domingo 20h · cache de mercado 9h nos dias úteis |
| **Custo** | R$ 0/mês (Always Free) + créditos Anthropic por mensagem |

**Por que x86 e não ARM:** São Paulo está sem capacidade de `VM.Standard.A1.Flex`,
e conta gratuita só pode assinar **uma região** — a Oracle recusa habilitar outra
(`TenantCapacityExceeded`). O `E2.1.Micro` também é Always Free e estava livre.

Consequência: 1 GB de RAM em vez de 12. Conversa e análise de ativo rodam bem;
operações que varrem o universo inteiro (recomendação de carteira) ficam lentas
e dependem do swap.

**Migrar para ARM quando houver capacidade:**
```bash
# cria a instância A1.Flex (2 OCPU / 12 GB) e repete o deploy
rsync -az --exclude .venv --exclude cache --exclude node_modules \
      --exclude auth_session ~/dev/investai/ ubuntu@NOVO_IP:~/investai/
scp .env ubuntu@NOVO_IP:~/investai/.env
scp bridge/.env ubuntu@NOVO_IP:~/investai/bridge/.env
ssh ubuntu@NOVO_IP 'cd ~/investai && bash deploy/instalar.sh'
# parear o QR de novo na máquina nova, depois desligar a antiga
```
