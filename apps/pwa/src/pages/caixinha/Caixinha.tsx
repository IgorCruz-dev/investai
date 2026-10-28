import { useEffect, useMemo, useState } from 'react'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import Esqueleto, { EsqueletoLista } from '../../components/Esqueleto'
import GraficoCaixinha from '../../components/GraficoCaixinha'
import ModalAcertarCaixinha from '../../components/ModalAcertarCaixinha'
import ModalCaixinha from '../../components/ModalCaixinha'
import ModalMetaCaixinha from '../../components/ModalMetaCaixinha'
import { IconeCaixa, IconeSetaBaixo, IconeSetaCima } from '../../components/icones'
import { useAuth } from '../../hooks/useAuth'
import { useLancamentos } from '../../hooks/useLancamentos'
import { SEM_PARTIDA, entraNoTotal, evolucaoMensal, totalGuardado, type PartidaCaixinha } from '../../lib/caixinha'
import { deISO } from '../../lib/datas'
import { formatarDiaMes, formatarMoeda } from '../../lib/formatar'
import { buscarConfigCaixinha, listarMovimentos } from '../../services/caixinha'
import type { MovimentoCaixinha } from '../../types/financas'

export default function Caixinha() {
  const { usuario } = useAuth()
  const { versao } = useLancamentos()
  const [movimentos, setMovimentos] = useState<MovimentoCaixinha[]>([])
  const [meta, setMeta] = useState<number | null>(null)
  const [partida, setPartida] = useState<PartidaCaixinha>(SEM_PARTIDA)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [recarregar, setRecarregar] = useState(0)

  const [modo, setModo] = useState<'guardar' | 'retirar' | null>(null)
  const [editandoMeta, setEditandoMeta] = useState(false)
  const [acertando, setAcertando] = useState(false)

  useEffect(() => {
    if (!usuario) return
    let ativo = true
    Promise.all([listarMovimentos(), buscarConfigCaixinha(usuario.id)])
      .then(([movs, config]) => {
        if (!ativo) return
        setMovimentos(movs)
        setMeta(config.meta)
        setPartida(config.partida)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar sua caixinha.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [usuario, versao, recarregar])

  const total = useMemo(() => totalGuardado(movimentos, partida), [movimentos, partida])
  const evolucao = useMemo(() => evolucaoMensal(movimentos, 12, new Date(), partida), [movimentos, partida])
  const progresso = meta ? Math.min((total / meta) * 100, 100) : 0
  const recarregou = () => setRecarregar((n) => n + 1)

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Caixinha</h1>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      {/* xl: total e botões numa coluna, gráfico e histórico nas outras duas */}
      <div className="xl:grid xl:grid-cols-3 xl:items-start xl:gap-6">
        <div>
          {/* Total guardado (+ meta) */}
          <div className="animate-surgir relative mt-6 overflow-hidden rounded-[28px] destaque destaque-azul p-6 text-white">
            <p className="text-sm font-medium opacity-75">Total guardado</p>
            {carregando ? (
              <Esqueleto className="mt-3 h-12 w-48 bg-black/10" />
            ) : (
              <p className="cifra mt-2 text-5xl font-semibold">{formatarMoeda(total)}</p>
            )}
            {!carregando && (
              <p className="mt-1 text-xs opacity-75">
                {partida.desde && <>Contando desde {formatarDiaMes(partida.desde)} · </>}
                <button onClick={() => setAcertando(true)} className="font-semibold underline underline-offset-2">
                  Acertar total
                </button>
              </p>
            )}

            {carregando ? null : meta ? (
              <div className="mt-5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="opacity-75">Meta: {formatarMoeda(meta)}</span>
                  <span className="font-semibold">{Math.floor(progresso)}%</span>
                </div>
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-black/10"
                  role="progressbar"
                  aria-label="Progresso da meta"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.floor(progresso)}
                >
                  <div
                    className="h-full rounded-full bg-sobre-primaria transition-all duration-700"
                    style={{ width: `${progresso}%` }}
                  />
                </div>
                <p className="mt-2 text-xs opacity-75">
                  {total >= meta ? 'Meta alcançada!' : `Faltam ${formatarMoeda(meta - total)}`} ·{' '}
                  <button onClick={() => setEditandoMeta(true)} className="font-semibold underline underline-offset-2">
                    Editar meta
                  </button>
                </p>
              </div>
            ) : (
              <button onClick={() => setEditandoMeta(true)} className="mt-4 text-sm font-semibold underline underline-offset-2">
                + Definir uma meta
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Botao onClick={() => setModo('guardar')}>Guardar</Botao>
            <Botao variante="secundaria" onClick={() => setModo('retirar')} disabled={total <= 0}>
              Retirar
            </Botao>
          </div>
        </div>

        <div className="xl:col-span-2">
          {/* No computador: gráfico ao lado do histórico */}
          {carregando ? (
            <div className="lg:mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
              <Card titulo="Evolução do total guardado" className="mt-6 lg:mt-0">
                <Esqueleto className="h-52" />
              </Card>
              <Card titulo="Histórico" className="mt-6 lg:mt-0" semEspaco>
                <EsqueletoLista linhas={3} />
              </Card>
            </div>
          ) : movimentos.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-[28px] solido px-5 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-texto/[0.07] text-texto-suave">
                <IconeCaixa className="h-6 w-6" />
              </span>
              <p className="mt-4 font-medium">Nada guardado ainda</p>
              <p className="mt-1 max-w-xs text-sm text-texto-suave">
                Toque em Guardar para separar um dinheiro do saldo da conta.
              </p>
            </div>
          ) : (
            <div className="lg:mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
              <Card titulo="Evolução do total guardado" className="mt-6 lg:mt-0">
                <GraficoCaixinha pontos={evolucao} />
              </Card>

              <Card titulo="Histórico" className="mt-6 lg:mt-0" semEspaco>
                <ul className="divide-y divide-borda">
                  {movimentos.map((m) => {
                    const retirada = m.tipo === 'retirada'
                    // Anterior à data de partida: fica no histórico, mas não soma no total
                    const conta = entraNoTotal(m, partida)
                    return (
                      <li
                        key={m.id}
                        className={`flex items-center gap-3 px-5 py-3.5 ${!conta ? 'opacity-50' : retirada ? 'border-l-4 border-l-despesa bg-despesa/[0.06]' : ''}`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${retirada ? 'bg-despesa/15 text-despesa' : 'bg-lilas/15 text-lilas'}`}
                        >
                          {retirada ? <IconeSetaCima className="h-4 w-4" /> : <IconeSetaBaixo className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            {/* Ligado a uma aplicação/resgate importado da caixinha do banco */}
                            {m.transacao_id
                              ? retirada
                                ? 'Resgate no banco'
                                : 'Guardado no banco'
                              : retirada
                                ? 'Retirada'
                                : 'Guardado'}
                          </span>
                          <span className="block truncate text-xs text-texto-suave">
                            {formatarDiaMes(m.data)} de {deISO(m.data).getFullYear()}
                            {m.motivo && !m.transacao_id && ` · ${m.motivo}`}
                            {!conta && ' · não entra no total'}
                          </span>
                        </span>
                        <span className={`shrink-0 font-semibold ${retirada ? 'text-despesa' : 'text-lilas'}`}>
                          {retirada ? '−' : '+'}
                          {formatarMoeda(m.valor)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            </div>
          )}
        </div>
      </div>

      {acertando && usuario && (
        <ModalAcertarCaixinha
          usuarioId={usuario.id}
          movimentos={movimentos}
          partida={partida}
          totalAtual={total}
          aoFechar={() => setAcertando(false)}
          aoSalvar={recarregou}
        />
      )}
      {modo && <ModalCaixinha modo={modo} disponivel={total} aoFechar={() => setModo(null)} aoSalvar={recarregou} />}
      {editandoMeta && usuario && (
        <ModalMetaCaixinha
          usuarioId={usuario.id}
          metaAtual={meta}
          aoFechar={() => setEditandoMeta(false)}
          aoSalvar={recarregou}
        />
      )}
    </>
  )
}
