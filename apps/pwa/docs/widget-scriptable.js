// Widget do InvestAI para o Scriptable (iPhone). Tamanhos: pequeno, médio e tela de bloqueio (retangular e em linha).
// Pequeno: saldo, teto de hoje e barra do gasto. Médio: isso + próxima fatura, gasto do mês e as 3 últimas notícias.
// Como instalar: Scriptable → + → cole este arquivo → nome "InvestAI". Tela de início → segure → + → Scriptable →
// escolha o tamanho → toque no widget → Script: InvestAI.
// A CHAVE só lê o resumo da Edge Function widget (tabela widget_chaves); para trocar, gere outra e apague a antiga.

const CHAVE = 'COLE_A_CHAVE_AQUI'
const API = 'https://acqjwxdpeojycpqffwrw.supabase.co/functions/v1/widget'
const APP = 'https://investai-two.vercel.app/dashboard'

const COR = {
  fundo: new Color('#0f1115'),
  texto: new Color('#f2f3f5'),
  fraco: new Color('#8b919c'),
  verde: new Color('#00c896'),
  amarelo: new Color('#f5c842'),
  vermelho: new Color('#ff4757'),
  trilho: new Color('#262a33'),
}

const reais = (x) => (x === null || x === undefined ? '—' : x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

async function buscar() {
  const req = new Request(API)
  req.headers = { 'x-chave': CHAVE }
  req.timeoutInterval = 20
  const dados = await req.loadJSON()
  if (dados.erro) throw new Error(dados.erro)
  return dados
}

function texto(pilha, conteudo, tamanho, cor = COR.texto, peso = 'regular') {
  const t = pilha.addText(conteudo)
  t.font = peso === 'bold' ? Font.boldSystemFont(tamanho) : peso === 'semibold' ? Font.semiboldSystemFont(tamanho) : Font.systemFont(tamanho)
  t.textColor = cor
  t.lineLimit = 1
  t.minimumScaleFactor = 0.6
  return t
}

/** Cor da barra: verde até 80% do teto, amarelo até 100%, vermelho acima */
const corDoGasto = (gasto, teto) => (!teto ? COR.fraco : gasto > teto ? COR.vermelho : gasto > teto * 0.8 ? COR.amarelo : COR.verde)

function barra(pilha, gasto, teto, largura) {
  const proporcao = teto ? Math.min(gasto / teto, 1) : 0
  const ctx = new DrawContext()
  ctx.size = new Size(largura, 6)
  ctx.opaque = false
  ctx.respectScreenScale = true
  const trilho = new Path()
  trilho.addRoundedRect(new Rect(0, 0, largura, 6), 3, 3)
  ctx.addPath(trilho)
  ctx.setFillColor(COR.trilho)
  ctx.fillPath()
  if (proporcao > 0) {
    const cheio = new Path()
    cheio.addRoundedRect(new Rect(0, 0, Math.max(largura * proporcao, 6), 6), 3, 3)
    ctx.addPath(cheio)
    ctx.setFillColor(corDoGasto(gasto, teto))
    ctx.fillPath()
  }
  pilha.addImage(ctx.getImage()).imageSize = new Size(largura, 6)
}

/** Saldo, teto e barra: o pequeno inteiro e a coluna da esquerda do médio */
function resumo(pilha, d, largura) {
  texto(pilha, 'SALDO', 10, COR.fraco, 'semibold')
  texto(pilha, reais(d.saldo), 20, COR.texto, 'bold')
  pilha.addSpacer(6)
  texto(pilha, 'TETO DE HOJE', 10, COR.fraco, 'semibold')
  texto(pilha, reais(d.teto), 15, COR.texto, 'semibold')
  pilha.addSpacer(4)
  barra(pilha, d.gasto_hoje, d.teto, largura)
  pilha.addSpacer(3)
  texto(pilha, `Gasto: ${reais(d.gasto_hoje)}`, 10, corDoGasto(d.gasto_hoje, d.teto))
}

function pequeno(w, d) {
  resumo(w, d, 120)
  w.addSpacer()
}

function medio(w, d) {
  const linha = w.addStack()
  const esq = linha.addStack()
  esq.layoutVertically()
  esq.size = new Size(130, 0)
  resumo(esq, d, 118)
  esq.addSpacer(6)
  if (d.fatura) texto(esq, `${d.fatura.cartao}: ${reais(d.fatura.valor)} · ${diaMes(d.fatura.vencimento)}`, 9, COR.fraco)
  texto(esq, `No mês: ${reais(d.gasto_mes)}`, 9, COR.fraco)
  esq.addSpacer()

  linha.addSpacer(10)
  const dir = linha.addStack()
  dir.layoutVertically()
  texto(dir, 'NOTÍCIAS', 10, COR.fraco, 'semibold')
  dir.addSpacer(4)
  for (const n of d.noticias.slice(0, 3)) {
    const item = dir.addStack()
    item.layoutVertically()
    item.url = n.link
    const t = texto(item, n.titulo, 11, COR.texto, 'semibold')
    t.lineLimit = 2
    t.minimumScaleFactor = 0.85
    if (n.fonte) texto(item, n.fonte, 9, COR.fraco)
    dir.addSpacer(5)
  }
  dir.addSpacer()
}

function bloqueio(w, d) {
  texto(w, `Saldo ${reais(d.saldo)}`, 13, Color.white(), 'bold')
  texto(w, `Teto ${reais(d.teto)}`, 12, Color.white())
  texto(w, `Gasto ${reais(d.gasto_hoje)}`, 12, Color.white())
}

const w = new ListWidget()
w.url = APP
const familia = config.widgetFamily ?? 'medium'
if (!familia.startsWith('accessory')) {
  w.backgroundColor = COR.fundo
  w.setPadding(14, 14, 14, 14)
}
try {
  const d = await buscar()
  if (familia === 'accessoryInline') texto(w, `Teto ${reais(d.teto)} · Gasto ${reais(d.gasto_hoje)}`, 12, Color.white())
  else if (familia.startsWith('accessory')) bloqueio(w, d)
  else if (familia === 'small') pequeno(w, d)
  else medio(w, d)
} catch (e) {
  texto(w, 'InvestAI', 14, COR.texto, 'bold')
  texto(w, String(e.message ?? e), 10, COR.vermelho).lineLimit = 3
}
w.refreshAfterDate = new Date(Date.now() + 15 * 60_000)

if (config.runsInWidget) Script.setWidget(w)
else await (familia === 'small' ? w.presentSmall() : w.presentMedium())
Script.complete()
