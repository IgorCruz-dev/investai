import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import { IconeSino } from '../../components/icones'
import { formatarDataHora } from '../../lib/formatar'
import {
  GRUPOS,
  buscarDesligadas,
  contarAparelhos,
  desligarNesteAparelho,
  enviarTeste,
  estadoDoPush,
  ligarNesteAparelho,
  salvarDesligadas,
  ultimasEnviadas,
  type EstadoPush,
  type TipoNotificacao,
} from '../../services/notificacoes'

type Enviada = Awaited<ReturnType<typeof ultimasEnviadas>>[number]

const TEXTO_DO_ESTADO: Record<EstadoPush, string> = {
  ligado: 'Este aparelho recebe os avisos.',
  desligado: 'Este aparelho ainda não recebe os avisos.',
  bloqueado: 'As notificações estão bloqueadas para o InvestAI neste navegador. Libere nas configurações do site e volte aqui.',
  sem_suporte: 'Este navegador não suporta notificações push.',
  precisa_instalar:
    'No iPhone, as notificações só funcionam com o app instalado: toque em Compartilhar → “Adicionar à Tela de Início” e abra o InvestAI por lá.',
}

/** Liga o push neste aparelho e escolhe quais avisos chegam */
export default function Notificacoes() {
  const [estado, setEstado] = useState<EstadoPush | null>(null)
  const [aparelhos, setAparelhos] = useState(0)
  const [desligadas, setDesligadas] = useState<Set<TipoNotificacao>>(new Set())
  const [enviadas, setEnviadas] = useState<Enviada[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  async function carregar() {
    const [e, n, d, u] = await Promise.all([estadoDoPush(), contarAparelhos(), buscarDesligadas(), ultimasEnviadas()])
    setEstado(e)
    setAparelhos(n)
    setDesligadas(d)
    setEnviadas(u)
  }

  useEffect(() => {
    carregar().catch(() => setErro('Não foi possível carregar as notificações.'))
  }, [])

  async function executar(acao: () => Promise<unknown>, sucesso?: string) {
    setErro('')
    setAviso('')
    setOcupado(true)
    try {
      await acao()
      if (sucesso) setAviso(sucesso)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  async function alternar(tipo: TipoNotificacao) {
    const novas = new Set(desligadas)
    if (novas.has(tipo)) novas.delete(tipo)
    else novas.add(tipo)
    const antes = desligadas
    setDesligadas(novas)
    try {
      await salvarDesligadas(novas)
    } catch (e) {
      setDesligadas(antes)
      setErro((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Notificações</h1>
      <p className="mt-1 text-sm text-texto-suave">
        Avisos no celular sobre prazos, gastos e investimentos. Cada um chega uma vez só, entre 8h e 22h; o bom dia sai às 7h45 e
        o da sincronização, na hora em que ela roda.
      </p>

      <div className="mt-5 space-y-3 empty:hidden">
        {erro && <Alerta>{erro}</Alerta>}
        {aviso && (
          <p role="status" className="rounded-xl bg-receita/12 px-3.5 py-3 text-sm text-receita">
            {aviso}
          </p>
        )}
      </div>

      <Card titulo="Este aparelho" icone={<IconeSino className="h-4 w-4" />} className="mt-5">
        <div className="px-5 pb-5">
          <p className="text-sm text-texto-suave">{estado ? TEXTO_DO_ESTADO[estado] : 'Verificando…'}</p>
          {aparelhos > 0 && (
            <p className="mt-1 text-xs text-texto-suave">
              {aparelhos === 1 ? '1 aparelho inscrito na sua conta.' : `${aparelhos} aparelhos inscritos na sua conta.`}
            </p>
          )}
          {(estado === 'desligado' || estado === 'ligado') && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {estado === 'desligado' ? (
                <Botao
                  carregando={ocupado}
                  onClick={() => executar(ligarNesteAparelho, 'Pronto! Este aparelho vai receber os avisos.')}
                >
                  Ativar neste aparelho
                </Botao>
              ) : (
                <>
                  <Botao
                    carregando={ocupado}
                    onClick={() => executar(enviarTeste, 'Teste enviado. Deve chegar em alguns segundos.')}
                  >
                    Enviar um teste
                  </Botao>
                  <Botao variante="secundaria" disabled={ocupado} onClick={() => executar(desligarNesteAparelho)}>
                    Desativar neste aparelho
                  </Botao>
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card titulo="O que avisar" className="mt-6">
        <div className="px-5 pb-5">
          {GRUPOS.map((grupo) => (
            <section key={grupo.titulo} className="mt-3 first:mt-0">
              <h3 className="text-xs font-semibold tracking-wide text-texto-suave uppercase">{grupo.titulo}</h3>
              <ul className="mt-1 divide-y divide-borda">
                {grupo.tipos.map((t) => {
                  const ligado = !desligadas.has(t.tipo)
                  return (
                    <li key={t.tipo}>
                      <label className="flex cursor-pointer items-center gap-4 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{t.nome}</span>
                          <span className="block text-xs text-texto-suave">{t.descricao}</span>
                        </span>
                        <input type="checkbox" className="peer sr-only" checked={ligado} onChange={() => alternar(t.tipo)} />
                        <span
                          aria-hidden="true"
                          className="relative h-6 w-10 shrink-0 rounded-full bg-texto/15 transition peer-checked:bg-primaria peer-focus-visible:ring-2 peer-focus-visible:ring-destaque after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-superficie after:shadow after:transition peer-checked:after:translate-x-4"
                        />
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </Card>

      {enviadas.length > 0 && (
        <Card titulo="Últimos avisos" className="mt-6">
          <ul className="divide-y divide-borda px-5 pb-3">
            {enviadas.map((n) => (
              <li key={n.id} className="py-3">
                <Link to={n.url ?? '/dashboard'} className="block hover:opacity-80">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{n.titulo}</span>
                    <span className="shrink-0 text-xs text-texto-suave">{formatarDataHora(n.enviada_em)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-texto-suave">{n.corpo}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
