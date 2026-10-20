/**
 * Ponte WhatsApp ↔ InvestAI.
 *
 * Baileys é Node e o sistema é Python, então esta ponte faz as duas metades:
 *   - recebe mensagem do WhatsApp  → POST para o servidor Python
 *   - expõe POST /send             → o Python manda a resposta de volta
 *
 * Não há webhook público: tudo é conexão de saída e um servidor HTTP preso ao
 * 127.0.0.1. Por isso não precisa de domínio, HTTPS nem porta aberta.
 *
 * A sessão fica em ./auth_session (um dispositivo vinculado, como o WhatsApp
 * Web). Vincular uma segunda sessão ao mesmo número é suportado — o WhatsApp
 * permite até 4 dispositivos.
 */

import { createServer } from 'node:http';
import { unlink } from 'node:fs';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import pino from 'pino';
import 'dotenv/config';

const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});

const PORT = Number(process.env.BRIDGE_PORT || 8900);
const SECRET = process.env.BRIDGE_SECRET || '';
const PYTHON_URL = process.env.INVESTAI_URL || 'http://127.0.0.1:8000/bridge/message';
const SEND_TIMEOUT_MS = Number(process.env.SEND_TIMEOUT_MS || 20000);
const QR_FILE = process.env.QR_FILE || 'qr.png';

/** Só estes números conversam com o assistente. Sem isso, qualquer contato que
 *  mande mensagem para o chip gasta créditos da API. */
const PERMITIDOS = new Set(
  (process.env.ALLOWED_NUMBERS || '')
    .split(',')
    .map((n) => n.trim().replace(/\D/g, ''))
    .filter(Boolean),
);

let socket = null;
let conectado = false;
let precisaReparear = false;
/** Ids das mensagens que nós mesmos enviamos — o WhatsApp devolve tudo que sai
 *  da conta como `fromMe`, inclusive o nosso próprio envio. */
const enviadosPorNos = new Set();

// ---------------------------------------------------------------- utilidades
function comTimeout(promessa, ms, rotulo) {
  return Promise.race([
    promessa,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout de ${ms}ms em ${rotulo}`)), ms)),
  ]);
}

/** Baileys 7 entrega remetentes como @lid; converte para o número real. */
async function resolverNumero(jid) {
  let origem = jid || '';
  if (origem.endsWith('@lid') && socket?.signalRepository) {
    try {
      const pn = await socket.signalRepository.lidMapping.getPNForLID(origem);
      if (pn) origem = pn;
    } catch (error) {
      log.debug({ error }, 'não foi possível resolver @lid');
    }
  }
  return origem.split('@')[0].split(':')[0];
}

function extrairTexto(msg) {
  const m = msg.message || {};
  return (
    m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title
    || ''
  ).trim();
}

// ------------------------------------------------------------------ WhatsApp
async function iniciarSocket() {
  if (socket) return;

  const { state, saveCreds } = await useMultiFileAuthState('./auth_session');

  socket = makeWASocket({
    auth: state,
    logger: pino({ level: 'error' }),
    printQRInTerminal: false,
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      conectado = false;
      log.info('Escaneie o QR: WhatsApp → Aparelhos conectados → Conectar aparelho');
      qrcode.generate(qr, { small: true });
      // Também em PNG: escanear do terminal falha quando a fonte é pequena ou
      // o tema tem baixo contraste.
      QRCode.toFile(QR_FILE, qr, { width: 420, margin: 2 })
        .then(() => log.info({ arquivo: QR_FILE }, 'QR também salvo como imagem'))
        .catch((error) => log.warn({ error: error.message }, 'não foi possível salvar o QR em PNG'));
    }

    if (connection === 'open') {
      conectado = true;
      precisaReparear = false;
      // QR usado é QR queimado: apagar evita alguém escanear um código velho.
      unlink(QR_FILE, () => {});
      log.info({ permitidos: PERMITIDOS.size }, 'Conectado ao WhatsApp');
    }

    if (connection === 'close') {
      conectado = false;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      socket = null;

      if (codigo === DisconnectReason.loggedOut) {
        precisaReparear = true;
        log.error('Sessão encerrada pelo WhatsApp. Apague ./auth_session e escaneie o QR de novo.');
        return;
      }
      log.warn({ codigo }, 'Conexão caiu — reconectando em 5s');
      setTimeout(iniciarSocket, 5000);
    }
  });

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await tratarMensagem(msg);
      } catch (error) {
        log.error({ error }, 'falha ao processar mensagem recebida');
      }
    }
  });
}

async function tratarMensagem(msg) {
  const remoteJid = msg.key.remoteJid || '';

  // Grupo e status não interessam a um assistente pessoal.
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;

  // `fromMe` cobre tanto o eco das nossas respostas quanto mensagens que o dono
  // do chip mandou do celular. Nos dois casos não há o que responder.
  if (msg.key.fromMe) {
    enviadosPorNos.delete(msg.key.id);
    return;
  }

  const numero = await resolverNumero(msg.key.senderPn || remoteJid);
  if (PERMITIDOS.size > 0 && !PERMITIDOS.has(numero)) {
    log.info({ numero: numero.slice(0, 6) + '…' }, 'número fora da lista branca — ignorado');
    return;
  }

  const texto = extrairTexto(msg);
  if (!texto) {
    await enviar(remoteJid, 'Por enquanto entendo só texto. Pode escrever o que você quer saber?');
    return;
  }

  log.info({ numero: numero.slice(0, 6) + '…', texto: texto.slice(0, 60) }, 'mensagem recebida');

  try {
    const resposta = await comTimeout(
      fetch(PYTHON_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': SECRET },
        body: JSON.stringify({ numero, jid: remoteJid, texto, message_id: msg.key.id }),
      }),
      120000,
      'POST para o servidor Python',
    );
    if (!resposta.ok) {
      log.error({ status: resposta.status }, 'servidor Python recusou a mensagem');
      await enviar(remoteJid, 'Meu servidor não respondeu agora. Tente de novo em instantes.');
    }
  } catch (error) {
    log.error({ error: error.message }, 'não foi possível falar com o servidor Python');
    await enviar(remoteJid, 'Estou sem conexão com o servidor. Tente de novo em instantes.');
  }
}

/** Envia texto, quebrando em partes (o WhatsApp corta em ~4.096 caracteres). */
async function enviar(jid, texto) {
  if (!socket || !conectado) throw new Error('socket desconectado');

  const limite = 3800;
  const partes = [];
  let atual = '';
  for (const bloco of String(texto).split('\n\n')) {
    if (atual && atual.length + bloco.length + 2 > limite) {
      partes.push(atual.trim());
      atual = '';
    }
    if (bloco.length > limite) {
      for (let i = 0; i < bloco.length; i += limite) partes.push(bloco.slice(i, i + limite));
      continue;
    }
    atual += bloco + '\n\n';
  }
  if (atual.trim()) partes.push(atual.trim());

  for (const parte of partes) {
    const enviada = await comTimeout(socket.sendMessage(jid, { text: parte }), SEND_TIMEOUT_MS, 'sendMessage');
    if (enviada?.key?.id) enviadosPorNos.add(enviada.key.id);
  }
}

// ----------------------------------------------------------- servidor local
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (pedaco) => {
      dados += pedaco;
      if (dados.length > 1e6) reject(new Error('corpo grande demais'));
    });
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

const servidor = createServer(async (req, res) => {
  const responder = (status, corpo) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(corpo));
  };

  if (req.method === 'GET' && req.url === '/status') {
    return responder(200, {
      conectado,
      precisa_reparear: precisaReparear,
      numeros_permitidos: PERMITIDOS.size,
    });
  }

  if (req.method === 'POST' && req.url === '/send') {
    if (SECRET && req.headers['x-bridge-secret'] !== SECRET) {
      return responder(403, { erro: 'segredo inválido' });
    }
    if (!conectado) {
      // 503 e não 500: re-tentar em segundos não adianta enquanto o WhatsApp
      // não estiver pareado. Quem chama deve desistir e avisar.
      return responder(503, { erro: 'socket desconectado', precisa_reparear: precisaReparear });
    }
    try {
      const { jid, numero, texto } = JSON.parse(await lerCorpo(req));
      const destino = jid || `${String(numero).replace(/\D/g, '')}@s.whatsapp.net`;
      await enviar(destino, texto);
      return responder(200, { status: 'enviado' });
    } catch (error) {
      log.error({ error: error.message }, 'falha ao enviar');
      return responder(500, { erro: error.message });
    }
  }

  responder(404, { erro: 'rota desconhecida' });
});

// ------------------------------------------------------------------- partida
servidor.listen(PORT, '127.0.0.1', () => {
  log.info({ porta: PORT, python: PYTHON_URL }, 'ponte ouvindo em 127.0.0.1');
});

if (!SECRET) log.warn('BRIDGE_SECRET vazio — qualquer processo local pode mandar mensagem pelo seu WhatsApp');
if (PERMITIDOS.size === 0) log.warn('ALLOWED_NUMBERS vazio — o assistente vai responder a QUALQUER contato');

iniciarSocket();

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    log.info('encerrando…');
    servidor.close();
    process.exit(0);
  });
}
