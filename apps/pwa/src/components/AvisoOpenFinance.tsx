import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useLancamentos } from '../hooks/useLancamentos'
import { problemaDaConexao, type ProblemaConexao } from '../lib/openFinance'
import { listarConexoes } from '../services/openFinance'
import { IconeAlerta, IconeFechar } from './icones'

const CHAVE = 'aviso-open-finance-fechado'

function lerFechados(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(CHAVE) ?? '[]')
  } catch {
    return []
  }
}

/** Faixa no topo quando uma conexão caiu ou o consentimento está perto de vencer; fecha até a próxima sessão */
export default function AvisoOpenFinance() {
  const { versao } = useLancamentos()
  const [problemas, setProblemas] = useState<(ProblemaConexao & { chave: string })[]>([])
  const [fechados, setFechados] = useState(lerFechados)

  useEffect(() => {
    let ativo = true
    listarConexoes()
      .then((conexoes) => {
        if (!ativo) return
        setProblemas(
          conexoes.flatMap((c) => {
            const p = problemaDaConexao(c)
            return p ? [{ ...p, chave: `${c.item_id}|${p.selo}` }] : []
          }),
        )
      })
      .catch(() => {}) // sem aviso é melhor que um erro no topo de todas as telas
    return () => {
      ativo = false
    }
  }, [versao])

  const visivel = problemas.find((p) => !fechados.includes(p.chave))
  if (!visivel) return null

  function fechar() {
    const novos = [...fechados, visivel!.chave]
    setFechados(novos)
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify(novos))
    } catch {
      // sem sessionStorage, fecha só até recarregar a página
    }
  }

  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${visivel.grave ? 'border-erro-borda bg-erro-fundo text-erro-texto' : 'border-aviso-borda bg-aviso-fundo text-aviso-texto'}`}
    >
      <IconeAlerta className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">
        {visivel.texto}{' '}
        <a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          Abrir meu.pluggy.ai
        </a>
        {' · '}
        <Link to="/bancos" className="font-semibold underline underline-offset-2">
          Ver bancos
        </Link>
      </span>
      <button onClick={fechar} aria-label="Fechar aviso" className="opacity-70 hover:opacity-100">
        <IconeFechar className="h-4 w-4" />
      </button>
    </div>
  )
}
