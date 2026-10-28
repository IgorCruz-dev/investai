import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useLancamentos } from '../hooks/useLancamentos'
import { formatarDataHora } from '../lib/formatar'
import { listarConexoes, reimportar, sincronizar, ultimaSincronizacao } from '../services/openFinance'
import type { SyncLog } from '../types/financas'
import { IconeBanco, IconeSincronizar } from './icones'

type Props = {
  /** No Início: some quando não há bancos conectados e mostra o link para a tela Bancos */
  compacto?: boolean
}

const corDoStatus: Record<SyncLog['status'], string> = {
  sucesso: 'text-texto-suave',
  parcial: 'text-alerta',
  erro: 'text-despesa',
}

/** Botão "Sincronizar" com a data e o resultado da última sincronização */
export default function Sincronizar({ compacto }: Props) {
  const { versao, recarregar } = useLancamentos()
  const [ultima, setUltima] = useState<SyncLog | null>(null)
  const [temConexao, setTemConexao] = useState<boolean | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    Promise.all([ultimaSincronizacao(), listarConexoes()])
      .then(([u, conexoes]) => {
        if (!ativo) return
        setUltima(u)
        setTemConexao(conexoes.length > 0)
      })
      .catch(() => ativo && setTemConexao(false))
    return () => {
      ativo = false
    }
  }, [versao])

  async function aoClicar(tudo = false) {
    setErro('')
    setSincronizando(true)
    try {
      await (tudo ? reimportar() : sincronizar())
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSincronizando(false)
      // Recarrega tudo (inclusive a última sincronização, que muda até quando dá erro)
      recarregar()
    }
  }

  if (compacto && !temConexao) return null

  // No Início: pílula com o ponto "ao vivo", a última sincronização e o botão redondo
  if (compacto) {
    return (
      <div
        className="vidro inline-flex max-w-full items-center gap-2 rounded-full py-1 pr-1 pl-3 sm:gap-2.5 sm:pl-3.5"
        aria-live="polite"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${erro || ultima?.status === 'erro' ? 'bg-despesa' : 'bg-primaria shadow-[0_0_10px_2px_rgb(212_175_55/0.55)]'}`}
        />
        <Link to="/bancos" className="min-w-0 truncate text-xs text-texto-suave transition hover:text-texto sm:text-sm">
          {sincronizando ? (
            'Buscando novidades...'
          ) : erro ? (
            erro
          ) : ultima ? (
            <>
              {/* No celular divide a linha com a data: o ponto verde já diz que está sincronizado */}
              <span className="hidden sm:inline">Sincronizado </span>
              {formatarDataHora(ultima.data)}
            </>
          ) : (
            'Bancos conectados'
          )}
        </Link>
        <button
          onClick={() => aoClicar()}
          disabled={sincronizando}
          aria-label="Sincronizar"
          title="Sincronizar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-texto/[0.08] text-texto transition hover:bg-texto/[0.14] disabled:opacity-60"
        >
          <IconeSincronizar className={`h-4 w-4 ${sincronizando ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }

  return (
    <div className="vidro flex items-center gap-3 rounded-[28px] p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primaria/12 text-destaque">
        <IconeBanco className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1" aria-live="polite">
        <p className="font-medium">Sincronização</p>
        <p className="truncate text-xs text-texto-suave">
          {sincronizando
            ? 'Buscando novidades nos bancos...'
            : ultima
              ? `Última: ${formatarDataHora(ultima.data)}`
              : 'Ainda não sincronizado'}
        </p>
        {!sincronizando && (erro || ultima?.mensagem) && (
          <p className={`mt-1 text-xs ${erro ? 'text-despesa' : corDoStatus[ultima!.status]}`}>{erro || ultima!.mensagem}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <button
          onClick={() => aoClicar()}
          disabled={sincronizando || temConexao === false}
          className="flex h-10 items-center gap-2 rounded-full bg-primaria px-4 text-sm font-semibold text-sobre-primaria transition hover:bg-primaria-escura disabled:opacity-60"
        >
          <IconeSincronizar className={`h-4 w-4 ${sincronizando ? 'animate-spin' : ''}`} />
          Sincronizar
        </button>
        {/* Puxa de novo os últimos 90 dias: corrige valores e datas que o banco mudou depois */}
        <button
          onClick={() => aoClicar(true)}
          disabled={sincronizando || temConexao === false}
          className="text-xs font-medium text-texto-suave underline-offset-2 transition hover:text-texto hover:underline disabled:opacity-60"
        >
          Reimportar 90 dias
        </button>
      </div>
    </div>
  )
}
