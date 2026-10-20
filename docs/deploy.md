# Colocar o InvestAI no ar

Do zero até o assistente respondendo no seu WhatsApp. **Sem cadastro na Meta** —
a conexão é via Baileys, no mesmo número que o StudyTrack já usa.

Custo de infraestrutura: **R$ 0/mês** (Oracle Always Free). Só os créditos da
API Anthropic: ~US$ 0,006 por mensagem.

## Como funciona

```
   Navegador (qualquer lugar)          Seu WhatsApp
          │ HTTPS                            │
          ▼                                  ▼
    Vercel (free)                   chip dedicado
   estático + /api/*                       │ (dispositivo vinculado)
          │                                 ▼
          │                    ponte Baileys (Node, 127.0.0.1:8900)
          │                                 │ HTTP local
          │                    servidor InvestAI (Python, 127.0.0.1:8000)
          │                                 │
          └────────► Neon Postgres ◄────────┘
                   (só conexões de saída)
```

**Nada é exposto à internet.** Não há webhook, domínio, HTTPS nem porta aberta
na VM: a ponte é um dispositivo vinculado (só conexões de saída), os dois
serviços conversam por `127.0.0.1`, e a interface web alcança seus dados pelo
banco gerenciado — nunca pela VM. Vercel e VM jamais se falam.

Três peças, cada uma fazendo o que sabe:

| | Onde | Por quê |
|---|---|---|
| Interface, login, CRUD | Vercel (free) | HTTPS e URL estável de graça, sem domínio |
| Carteira, movimentações, perfil | Neon Postgres (free) | Os dois clientes precisam ver o mesmo dado |
| yfinance, indicadores, Claude, WhatsApp | VM Oracle (free) | Python pesado e a sessão do Baileys |

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
cp apps/bridge/.env.example apps/bridge/.env   && nano apps/bridge/.env   # passo 3
bash deploy/install.sh
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

# Banco (Neon) — endpoint DIRETO, não o com "-pooler":
DATABASE_URL=postgresql://...@ep-xxx.REGIAO.aws.neon.tech/neondb?sslmode=require
INVESTAI_WEB_URL=https://seu-projeto.vercel.app   # aparece no /web e no /status
```

**`~/investai/apps/bridge/.env`** (ponte Node):
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

A sessão fica salva em `apps/bridge/auth_session/` — não precisa parear de novo a
cada reinício. Para trocar de chip: apague a pasta e escaneie outro QR.

---

## 4.5 Banco (Neon) e interface web (Vercel)

Esta parte é nova: é o que faz a interface existir fora do notebook.

### Neon

1. Crie a conta em <https://neon.tech> e um projeto chamado `investai`.
   Escolha a região mais perto da VM — a latência entra em **toda** consulta
   do assistente.
2. Em **Connect**, copie a connection string. Você precisa de **duas** formas
   da mesma URL, e a diferença é só o `-pooler` no host:
   - sem `-pooler` → `DATABASE_URL` (psycopg, na VM e no notebook)
   - com `-pooler` → `DATABASE_URL_POOLED` (funções serverless da Vercel)
3. Aplique o esquema e semeie o catálogo de 38 ativos:

```bash
.venv/bin/python scripts/migrate_to_postgres.py
.venv/bin/python scripts/migrate_to_postgres.py --conferir   # mostra o estado
```

O script é idempotente: rodar duas vezes não duplica nada.

### Vercel

```bash
cd apps/web
npm install
vercel login
vercel --prod
```

Depois defina as variáveis do projeto (em **Settings → Environment Variables**,
ou pelo CLI):

| Variável | Valor |
|---|---|
| `DATABASE_URL_POOLED` | a URL **com** `-pooler` |
| `WEB_PASSWORD_HASH` | o hash da sua senha (gerado abaixo) |
| `WEB_SESSION_SECRET` | 32 bytes aleatórios em hex |

Gerando os dois segredos:

```bash
cd apps/web
node --input-type=module -e "
  import { gerarHash } from './api/_auth.js';
  import crypto from 'node:crypto';
  console.log('WEB_PASSWORD_HASH =', await gerarHash(process.argv[1]));
  console.log('WEB_SESSION_SECRET =', crypto.randomBytes(32).toString('hex'));
" "SUA-SENHA-AQUI"
```

A senha em si não é guardada em lugar nenhum — nem no repositório, nem no
banco, nem no `.env`. Só o hash PBKDF2 vai para a Vercel.

Por fim, ponha a URL publicada em `INVESTAI_WEB_URL` no `.env` da VM, para o
comando `/web` do assistente devolver o endereço.

---

## 5. Testar

Mande "oi" do seu celular para o número do chip. Deve responder em segundos.

```
/ajuda                        → menu numerado (custo zero)
como está minha carteira?     → posições, valor e P&L (custo zero)
comprei 100 PETR4 a 35,50     → pede confirmação; "sim" grava (custo zero)
/extrato                      → o histórico, com #id de cada linha
quanto está a VALE3           → cotação (custo zero)
/onboarding                   → as 18 perguntas de perfil (custo zero)
/status                       → ponte, banco e quanto gastou no mês
analisa PETR4                 → leitura do papel com IA (~US$ 0,02)
me manda o briefing           → confirma antes; ~1 min (~US$ 0,10)
```

Depois, abra a URL da Vercel no celular: a compra que você registrou pelo
WhatsApp tem de estar lá, e vice-versa.

---

## 6. Briefing semanal

```bash
sudo timedatectl set-timezone America/Sao_Paulo
crontab -e      # cole deploy/crontab.example e troque SEU_CRON_TOKEN
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
# A carteira e o perfil vivem no Neon, que tem backup próprio. Daqui saem o
# espelho legível, o histórico de conversa e — o insubstituível — a sessão do
# WhatsApp: perdê-la significa parear o QR de novo.
ssh ubuntu@SEU_IP 'cd ~/investai && tar czf - config/*.json cache/investai.db \
    .env apps/bridge/.env apps/bridge/auth_session' > backup-$(date +%F).tar.gz

# Dump do banco (pg_dump via a connection string do Neon)
pg_dump "$DATABASE_URL" -f backup-banco-$(date +%F).sql
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
scp apps/bridge/.env ubuntu@NOVO_IP:~/investai/apps/bridge/.env
ssh ubuntu@NOVO_IP 'cd ~/investai && bash deploy/install.sh'
# parear o QR de novo na máquina nova, depois desligar a antiga
```
