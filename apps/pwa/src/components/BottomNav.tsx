import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { IconeCartao, IconeCasa, IconeGrafico, IconeRendimento, IconeRepetir } from './icones'

export const abas: { to: string; label: string; icone: ReactNode }[] = [
  { to: '/dashboard', label: 'Início', icone: <IconeCasa /> },
  { to: '/cartoes', label: 'Cartões', icone: <IconeCartao /> },
  { to: '/assinaturas', label: 'Fixos', icone: <IconeRepetir /> },
  { to: '/comparativo', label: 'Comparativo', icone: <IconeGrafico /> },
  { to: '/investimentos', label: 'Investimentos', icone: <IconeRendimento /> },
]

// No celular o Início fica no meio, ao alcance do polegar
const ordemNoCelular = [abas[1], abas[2], abas[0], abas[3], abas[4]]

/** Dock de vidro flutuante (só celular); a pílula clara desliza até a aba ativa, que cresce um pouco */
export default function BottomNav() {
  const { pathname } = useLocation()
  const ativa = ordemNoCelular.findIndex(({ to }) => pathname === to || pathname.startsWith(`${to}/`))
  const itens = useRef<(HTMLLIElement | null)[]>([])
  const [pilula, setPilula] = useState<{ left: number; width: number } | null>(null)
  // Na primeira medida a pílula só aparece no lugar; depois disso, desliza
  const [animar, setAnimar] = useState(false)

  useLayoutEffect(() => {
    const medir = () => {
      const li = itens.current[ativa]
      setPilula(li ? { left: li.offsetLeft, width: li.offsetWidth } : null)
    }
    medir()
    const observador = new ResizeObserver(medir)
    for (const li of itens.current) if (li) observador.observe(li)
    return () => observador.disconnect()
  }, [ativa])

  useLayoutEffect(() => {
    if (!pilula || animar) return
    const quadro = requestAnimationFrame(() => setAnimar(true))
    return () => cancelAnimationFrame(quadro)
  }, [pilula, animar])

  return (
    <nav className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-30 lg:hidden">
      <ul className="vidro-forte relative mx-auto flex max-w-md gap-1 rounded-full p-1.5">
        {pilula && (
          <span
            aria-hidden
            className={`absolute top-1.5 bottom-1.5 rounded-full bg-texto shadow-[0_6px_20px_-8px_rgb(243_243_238/0.55)] ${animar ? 'transition-[left,width] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none' : ''}`}
            style={{ left: pilula.left - 2, width: pilula.width + 4 }}
          />
        )}
        {ordemNoCelular.map(({ to, label, icone }, i) => (
          <li
            key={to}
            ref={(li) => {
              itens.current[i] = li
            }}
            className="relative min-w-0 flex-auto"
          >
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex h-12 flex-col items-center justify-center gap-0.5 rounded-full px-2.5 text-[10px] font-medium tracking-tight transition-[color,scale] duration-300 motion-reduce:transition-none ${isActive ? 'scale-[1.08] text-fundo' : 'text-texto-suave hover:text-texto'}`
              }
            >
              {icone}
              {/* Nome comprido não invade a aba do lado */}
              <span className="max-w-full truncate leading-tight">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
