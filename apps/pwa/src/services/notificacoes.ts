import { supabase } from '../lib/supabase'

// Chave pública VAPID (a privada fica no secret VAPID_KEYS da Edge Function notificar). Pública mesmo: vai para o navegador.
const CHAVE_PUBLICA = 'BOv5OHly73VgqukKHSrDQRor2bYXI0_-OkktZVqPgky1IzmRRK8RTbqirxgddwCGIGa_2d8G01_waBCuha9-MG8'

export type TipoNotificacao =
  | 'fatura'
  | 'assinatura'
  | 'receita'
  | 'gasto_alto'
  | 'resumo_semanal'
  | 'fechamento'
  | 'acerto'
  | 'reserva'
  | 'radar'
  | 'tese'
  | 'dolar'
  | 'conexao'
  | 'ia'
  | 'sincronizacao'
  | 'bom_dia'
  | 'teto'
  | 'coleta'
  | 'fatura_fechou'
  | 'duplicada'
  | 'preco_assinatura'
  | 'nova_assinatura'
  | 'acerto_recebido'
  | 'sem_categoria'
  | 'selic'
  | 'noticia'

/** Os tipos agrupados como aparecem na tela (mesmos nomes da Edge Function) */
export const GRUPOS: { titulo: string; tipos: { tipo: TipoNotificacao; nome: string; descricao: string }[] }[] = [
  {
    titulo: 'Rotina',
    tipos: [
      { tipo: 'bom_dia', nome: 'Bom dia', descricao: 'Às 7h45, o saldo de hoje e quanto dá para gastar no dia' },
      {
        tipo: 'sincronizacao',
        nome: 'Sincronização com o banco',
        descricao: 'Às 7h, 18h e 21h10, quando a sincronização automática traz lançamentos novos',
      },
      { tipo: 'teto', nome: 'Passou do teto', descricao: 'Às 21h30, se o gasto do dia passou da sugestão do bom dia' },
      {
        tipo: 'coleta',
        nome: 'Dados atualizados',
        descricao: 'Cada vez que o app puxa notícias, dados do Banco Central ou o radar',
      },
    ],
  },
  {
    titulo: 'Prazos',
    tipos: [
      { tipo: 'fatura', nome: 'Fatura vencendo', descricao: '3 dias antes e no dia, com o que falta pagar' },
      { tipo: 'fatura_fechou', nome: 'Fatura fechou', descricao: 'No dia do fechamento, com o valor e o vencimento' },
      { tipo: 'assinatura', nome: 'Assinaturas de amanhã', descricao: 'Os fixos que vão cair no dia seguinte' },
      { tipo: 'receita', nome: 'Receita atrasada', descricao: 'Quando uma receita prevista passa do dia e não entra' },
    ],
  },
  {
    titulo: 'Dinheiro mexendo',
    tipos: [
      { tipo: 'gasto_alto', nome: 'Gasto fora do padrão', descricao: 'Compra nova bem acima do seu gasto médio' },
      { tipo: 'duplicada', nome: 'Cobrança duplicada', descricao: 'Mesmo valor, no mesmo lugar e no mesmo dia' },
      { tipo: 'preco_assinatura', nome: 'Assinatura mudou de preço', descricao: 'Cobrança diferente da do mês anterior' },
      {
        tipo: 'nova_assinatura',
        nome: 'Possível assinatura nova',
        descricao: 'Mesmo lugar cobrando todo mês e ainda fora de Assinaturas',
      },
      { tipo: 'resumo_semanal', nome: 'Resumo da semana', descricao: 'Domingo à noite, comparado com a semana anterior' },
      { tipo: 'fechamento', nome: 'Fechamento do mês', descricao: 'No começo do mês: sobra ou falta do anterior' },
      { tipo: 'acerto', nome: 'Acertos parados', descricao: 'Segunda-feira, quem te deve há mais de uma semana' },
      { tipo: 'acerto_recebido', nome: 'Acerto recebido', descricao: 'Quando alguém que te devia paga' },
      { tipo: 'sem_categoria', nome: 'Lançamentos sem categoria', descricao: 'Sábado de manhã, se juntar 5 ou mais' },
    ],
  },
  {
    titulo: 'Investimentos e radar',
    tipos: [
      { tipo: 'reserva', nome: 'Marcos da reserva', descricao: '25%, 50%, 75% e reserva completa' },
      { tipo: 'radar', nome: 'Teses novas', descricao: 'À noite, as teses do dia que valem para você' },
      { tipo: 'tese', nome: 'Resultado das teses', descricao: 'Quando o prazo de uma tese acaba' },
      { tipo: 'dolar', nome: 'Dólar mexendo', descricao: 'Variação de 2% ou mais num dia' },
      { tipo: 'selic', nome: 'Selic mudou', descricao: 'Quando o Copom sobe ou corta a Selic' },
      { tipo: 'noticia', nome: 'Notícias importantes', descricao: 'Só as de relevância 0,9 ou mais' },
    ],
  },
  {
    titulo: 'Manutenção',
    tipos: [
      { tipo: 'conexao', nome: 'Conexões do Open Finance', descricao: 'Consentimento acabando ou sincronização parada' },
      { tipo: 'ia', nome: 'Limite da IA', descricao: 'Gasto do mês em 80% e 100% do teto' },
    ],
  },
]

export type EstadoPush = 'sem_suporte' | 'precisa_instalar' | 'bloqueado' | 'desligado' | 'ligado'

const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const instalado = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** No iPhone o push só existe com o app instalado na tela de início */
export function iosSemInstalar() {
  return ehIOS() && !instalado()
}

async function registro() {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function estadoDoPush(): Promise<EstadoPush> {
  if (iosSemInstalar()) return 'precisa_instalar'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'sem_suporte'
  if (Notification.permission === 'denied') return 'bloqueado'
  const reg = await registro()
  const inscricao = await reg?.pushManager.getSubscription()
  return inscricao && Notification.permission === 'granted' ? 'ligado' : 'desligado'
}

function chaveEmBytes(base64: string) {
  const b64 = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function nomeDoAparelho() {
  const ua = navigator.userAgent
  const sistema = /iphone|ipad/i.test(ua)
    ? 'iPhone'
    : /android/i.test(ua)
      ? 'Android'
      : /mac/i.test(ua)
        ? 'Mac'
        : /windows/i.test(ua)
          ? 'Windows'
          : 'Navegador'
  const navegador = /edg\//i.test(ua)
    ? 'Edge'
    : /chrome|crios/i.test(ua)
      ? 'Chrome'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /safari/i.test(ua)
          ? 'Safari'
          : ''
  return navegador ? `${sistema} · ${navegador}` : sistema
}

/** Pede permissão, inscreve este aparelho e guarda a inscrição no banco */
export async function ligarNesteAparelho() {
  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted')
    throw new Error('Permissão negada. Libere as notificações do InvestAI nas configurações do navegador.')
  const reg = (await registro()) ?? (await navigator.serviceWorker.ready)
  const inscricao =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveEmBytes(CHAVE_PUBLICA) }))
  const json = inscricao.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
    throw new Error('O navegador não devolveu as chaves da inscrição.')
  const { error } = await supabase
    .from('push_inscricoes')
    .upsert(
      { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, dispositivo: nomeDoAparelho() },
      { onConflict: 'endpoint' },
    )
  if (error) {
    console.error(error)
    throw new Error('Não foi possível salvar a inscrição. Tente de novo.')
  }
}

/** Cancela a inscrição deste aparelho (os outros continuam recebendo) */
export async function desligarNesteAparelho() {
  const inscricao = await (await registro())?.pushManager.getSubscription()
  if (!inscricao) return
  await supabase.from('push_inscricoes').delete().eq('endpoint', inscricao.endpoint)
  await inscricao.unsubscribe()
}

export async function contarAparelhos() {
  const { count, error } = await supabase.from('push_inscricoes').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

export async function buscarDesligadas() {
  const { data, error } = await supabase.from('notificacoes_preferencias').select('desligadas').maybeSingle()
  if (error) throw error
  return new Set((data?.desligadas ?? []) as TipoNotificacao[])
}

export async function salvarDesligadas(desligadas: Set<TipoNotificacao>) {
  const { error } = await supabase
    .from('notificacoes_preferencias')
    .upsert({ desligadas: [...desligadas], atualizado_em: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) {
    console.error(error)
    throw new Error('Não foi possível salvar a preferência.')
  }
}

export async function enviarTeste() {
  const { data, error } = await supabase.functions.invoke('notificar', { body: { teste: true } })
  if (error) throw new Error('Não foi possível enviar o teste.')
  if (data?.erro) throw new Error(data.erro)
  return data as { enviados: number }
}

export async function ultimasEnviadas() {
  const { data, error } = await supabase
    .from('notificacoes_enviadas')
    .select('id, tipo, titulo, corpo, url, enviada_em')
    .order('enviada_em', { ascending: false })
    .limit(10)
  if (error) throw error
  return data
}
