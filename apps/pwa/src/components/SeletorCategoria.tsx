import { useState, type KeyboardEvent } from 'react'
import { criarCategoria } from '../services/categorias'
import type { Categoria } from '../types/financas'
import { IconeMais } from './icones'

type Props = {
  categorias: Categoria[]
  valor: string | null
  aoMudar: (id: string | null) => void
  /** Chamado quando uma categoria nova é criada aqui (ela já vem selecionada) */
  aoCriar: (categoria: Categoria) => void
}

const paleta = ['#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#ef4444', '#d4af37']

export default function SeletorCategoria({ categorias, valor, aoMudar, aoCriar }: Props) {
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState(paleta[0])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function criar() {
    if (!nome.trim()) return setErro('Dê um nome para a categoria.')
    setErro('')
    setSalvando(true)
    try {
      const nova = await criarCategoria(nome, cor)
      aoCriar(nova)
      aoMudar(nova.id)
      setCriando(false)
      setNome('')
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  // Enter no nome cria a categoria em vez de enviar o formulário do lançamento
  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      criar()
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-texto">Categoria</span>
      <div role="group" aria-label="Categoria" className="flex flex-wrap gap-2">
        {categorias.map((c) => {
          const escolhida = c.id === valor
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={escolhida}
              onClick={() => aoMudar(escolhida ? null : c.id)}
              className={`flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition ${escolhida ? 'border-primaria bg-sucesso-fundo font-medium text-primaria' : 'border-borda bg-superficie text-texto hover:border-borda-forte'}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.cor }} />
              {c.nome}
            </button>
          )
        })}
        {!criando && (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-dashed border-borda-forte px-3 text-sm font-medium text-texto-suave transition hover:border-primaria hover:text-primaria"
          >
            <IconeMais className="h-4 w-4" />
            Nova
          </button>
        )}
      </div>

      {criando && (
        <div className="mt-1 flex flex-col gap-3 rounded-xl border border-borda bg-superficie-2 p-3">
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={aoTeclar}
            placeholder="Nome da categoria"
            aria-label="Nome da nova categoria"
            maxLength={30}
            className="h-11 rounded-lg border border-borda bg-superficie px-3 text-base outline-none focus:border-primaria focus:ring-4 focus:ring-primaria/15"
          />
          <div role="group" aria-label="Cor" className="flex flex-wrap gap-2">
            {paleta.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={c === cor}
                onClick={() => setCor(c)}
                className={`h-7 w-7 rounded-full transition ${c === cor ? 'ring-2 ring-texto ring-offset-2' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {erro && <p className="text-sm text-despesa">{erro}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={criar}
              disabled={salvando}
              className="h-10 flex-1 rounded-lg bg-primaria text-sm font-semibold text-sobre-primaria transition hover:bg-primaria-escura disabled:opacity-70"
            >
              {salvando ? 'Criando...' : 'Criar categoria'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCriando(false)
                setErro('')
              }}
              className="h-10 rounded-lg px-4 text-sm font-medium text-texto-suave transition hover:bg-superficie hover:text-texto"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
