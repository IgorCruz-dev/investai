import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useLancamentos } from '../hooks/useLancamentos'
import { formatarDataHora } from '../lib/formatar'
import { listarConexoes, sincronizar, ultimaSincronizacao } from '../services/openFinance'
import type { SyncLog } from '../types/financas'
import { IconeBanco, IconeSincronizar } from './icones'

type Props = {
  /** No Início: some quando não há bancos conectados e mostra o link para a tela Bancos */
  compacto?: boolean
}

const corDoStatus: Record<SyncLog['status'], string> = {
  sucesso: 'text-texto-suave',
  parcial: 'text-amber-700',
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

  async function aoClicar() {
    setErro('')
    setSincronizando(true)
    try {
      await sincronizar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSincronizando(false)
      // Recarrega tudo (inclusive a última sincronização, que muda até quando dá erro)
      recarregar()
    }
  }

  if (compacto && !temConexao) return null

  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-borda bg-white ${compacto ? 'px-4 py-3' : 'p-5'}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-primaria">
        <IconeBanco className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1" aria-live="polite">
        {compacto ? (
          <Link to="/bancos" className="font-medium hover:underline">
            Bancos conectados
          </Link>
        ) : (
          <p className="font-medium">Sincronização</p>
        )}
        <p className="truncate text-xs text-texto-suave">
          {sincronizando
            ? 'Buscando novidades nos bancos...'
            : ultima
              ? `Última: ${formatarDataHora(ultima.data)}`
              : 'Ainda não sincronizado'}
        </p>
        {!sincronizando && (erro || (!compacto && ultima?.mensagem)) && (
          <p className={`mt-1 text-xs ${erro ? 'text-despesa' : corDoStatus[ultima!.status]}`}>{erro || ultima!.mensagem}</p>
        )}
      </div>
      <button
        onClick={aoClicar}
        disabled={sincronizando || temConexao === false}
        className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-primaria px-3.5 text-sm font-semibold text-white transition hover:bg-primaria-escura disabled:opacity-60"
      >
        <IconeSincronizar className={`h-4 w-4 ${sincronizando ? 'animate-spin' : ''}`} />
        <span className={compacto ? 'sr-only sm:not-sr-only' : ''}>Sincronizar</span>
      </button>
    </div>
  )
}
