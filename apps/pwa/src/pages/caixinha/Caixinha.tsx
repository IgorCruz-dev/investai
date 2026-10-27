import { useEffect, useMemo, useState } from 'react'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import Esqueleto, { EsqueletoLista } from '../../components/Esqueleto'
import GraficoCaixinha from '../../components/GraficoCaixinha'
import ModalCaixinha from '../../components/ModalCaixinha'
import ModalMetaCaixinha from '../../components/ModalMetaCaixinha'
import { IconeCaixa, IconeSetaBaixo, IconeSetaCima } from '../../components/icones'
import { useAuth } from '../../hooks/useAuth'
import { useLancamentos } from '../../hooks/useLancamentos'
import { evolucaoMensal, totalGuardado } from '../../lib/caixinha'
import { deISO } from '../../lib/datas'
import { formatarDiaMes, formatarMoeda } from '../../lib/formatar'
import { buscarMeta, listarMovimentos } from '../../services/caixinha'
import type { MovimentoCaixinha } from '../../types/financas'

export default function Caixinha() {
  const { usuario } = useAuth()
  const { versao } = useLancamentos()
  const [movimentos, setMovimentos] = useState<MovimentoCaixinha[]>([])
  const [meta, setMeta] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [recarregar, setRecarregar] = useState(0)

  const [modo, setModo] = useState<'guardar' | 'retirar' | null>(null)
  const [editandoMeta, setEditandoMeta] = useState(false)

  useEffect(() => {
    if (!usuario) return
    let ativo = true
    Promise.all([listarMovimentos(), buscarMeta(usuario.id)])
      .then(([movs, m]) => {
        if (!ativo) return
        setMovimentos(movs)
        setMeta(m)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar sua caixinha.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [usuario, versao, recarregar])

  const total = useMemo(() => totalGuardado(movimentos), [movimentos])
  const evolucao = useMemo(() => evolucaoMensal(movimentos), [movimentos])
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

      {/* Total guardado (+ meta) */}
      <div className="mt-6 destaque destaque-azul p-6 text-white">
        <p className="text-sm text-white/70">Total guardado</p>
        {carregando ? (
          <Esqueleto className="mt-3 h-10 w-44 bg-white/25" />
        ) : (
          <p className="mt-2 text-4xl font-bold tracking-tight">{formatarMoeda(total)}</p>
        )}

        {carregando ? null : meta ? (
          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-white/70">Meta: {formatarMoeda(meta)}</span>
              <span className="font-semibold">{Math.floor(progresso)}%</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-white/20"
              role="progressbar"
              aria-label="Progresso da meta"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.floor(progresso)}
            >
              <div className="h-full rounded-full bg-superficie transition-all" style={{ width: `${progresso}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/70">
              {total >= meta ? 'Meta alcançada!' : `Faltam ${formatarMoeda(meta - total)}`} ·{' '}
              <button onClick={() => setEditandoMeta(true)} className="font-semibold text-white underline-offset-2 hover:underline">
                Editar meta
              </button>
            </p>
          </div>
        ) : (
          <button
            onClick={() => setEditandoMeta(true)}
            className="mt-4 text-sm font-semibold text-white underline-offset-2 hover:underline"
          >
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

      {carregando ? (
        <>
          <Card titulo="Evolução do total guardado" className="mt-6">
            <Esqueleto className="h-52" />
          </Card>
          <Card titulo="Histórico" className="mt-6" semEspaco>
            <EsqueletoLista linhas={3} />
          </Card>
        </>
      ) : movimentos.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-borda bg-superficie px-5 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-superficie-3 text-texto-suave">
            <IconeCaixa className="h-6 w-6" />
          </span>
          <p className="mt-4 font-medium">Nada guardado ainda</p>
          <p className="mt-1 max-w-xs text-sm text-texto-suave">
            Toque em Guardar para separar um dinheiro do saldo da conta.
          </p>
        </div>
      ) : (
        <>
          <Card titulo="Evolução do total guardado" className="mt-6">
            <GraficoCaixinha pontos={evolucao} />
          </Card>

          <Card titulo="Histórico" className="mt-6" semEspaco>
            <ul className="divide-y divide-borda">
              {movimentos.map((m) => {
                const retirada = m.tipo === 'retirada'
                return (
                  <li
                    key={m.id}
                    className={`flex items-center gap-3 px-5 py-3.5 ${retirada ? 'border-l-4 border-l-despesa bg-erro-fundo' : ''}`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${retirada ? 'bg-erro-fundo text-despesa' : 'bg-info-fundo text-info-texto'}`}
                    >
                      {retirada ? <IconeSetaCima className="h-4 w-4" /> : <IconeSetaBaixo className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{retirada ? 'Retirada' : 'Guardado'}</span>
                      <span className="block truncate text-xs text-texto-suave">
                        {formatarDiaMes(m.data)} de {deISO(m.data).getFullYear()}
                        {m.motivo && ` · ${m.motivo}`}
                      </span>
                    </span>
                    <span className={`shrink-0 font-semibold ${retirada ? 'text-despesa' : 'text-info-texto'}`}>
                      {retirada ? '−' : '+'}
                      {formatarMoeda(m.valor)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      )}

      {modo && <ModalCaixinha modo={modo} disponivel={total} aoFechar={() => setModo(null)} aoSalvar={recarregou} />}
      {editandoMeta && usuario && (
        <ModalMetaCaixinha usuarioId={usuario.id} metaAtual={meta} aoFechar={() => setEditandoMeta(false)} aoSalvar={recarregou} />
      )}
    </>
  )
}
