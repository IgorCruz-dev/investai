import { useState } from 'react'

type Tema = 'claro' | 'escuro'

const CHAVE = 'investai:tema'
const COR_DA_BARRA = { claro: '#f7f6f2', escuro: '#0a0a0f' }

function temaAtual(): Tema {
  return document.documentElement.dataset.tema === 'claro' ? 'claro' : 'escuro'
}

/** Aplica o tema no <html> (o index.html já aplica o salvo antes de pintar a tela) e lembra a escolha */
function aplicarTema(tema: Tema) {
  const html = document.documentElement
  if (tema === 'claro') html.dataset.tema = 'claro'
  else delete html.dataset.tema
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_DA_BARRA[tema])
  try {
    localStorage.setItem(CHAVE, tema)
  } catch {
    // navegação privada: vale só nesta visita
  }
}

function IconeSol() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function IconeLua() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Switch claro/escuro: pílula com sol e lua, a bolinha desliza para o tema escolhido.
 * Compacto (barra lateral recolhida): só um botão redondo com o ícone do tema atual.
 */
export default function TrocaTema({ className = '', compacto = false }: { className?: string; compacto?: boolean }) {
  const [tema, setTema] = useState<Tema>(temaAtual)
  const escuro = tema === 'escuro'

  function alternar() {
    const novo: Tema = escuro ? 'claro' : 'escuro'
    aplicarTema(novo)
    setTema(novo)
  }

  if (compacto) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={escuro}
        aria-label="Modo escuro"
        title={escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
        onClick={alternar}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-texto/[0.08] text-texto transition hover:bg-texto/[0.12] ${className}`}
      >
        {escuro ? <IconeLua /> : <IconeSol />}
      </button>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={escuro}
      aria-label="Modo escuro"
      title={escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
      onClick={alternar}
      className={`relative flex h-9 w-[4.25rem] shrink-0 items-center rounded-full bg-texto/[0.08] p-1 transition hover:bg-texto/[0.12] ${className}`}
    >
      <span
        className={`absolute top-1 left-1 h-7 w-7 rounded-full bg-texto shadow-sm transition-transform duration-300 ease-[cubic-bezier(.2,.9,.25,1)] ${escuro ? 'translate-x-8' : ''}`}
        aria-hidden="true"
      />
      <span
        className={`relative flex h-7 w-7 items-center justify-center transition ${escuro ? 'text-texto-suave' : 'text-fundo'}`}
      >
        <IconeSol />
      </span>
      <span
        className={`relative ml-1 flex h-7 w-7 items-center justify-center transition ${escuro ? 'text-fundo' : 'text-texto-suave'}`}
      >
        <IconeLua />
      </span>
    </button>
  )
}
