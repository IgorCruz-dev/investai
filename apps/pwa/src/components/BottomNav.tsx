import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { IconeCaixa, IconeCartao, IconeCasa, IconeGrafico, IconeRepetir } from './icones'

const abas: { to: string; label: string; icone: ReactNode }[] = [
  { to: '/dashboard', label: 'Início', icone: <IconeCasa /> },
  { to: '/cartoes', label: 'Cartões', icone: <IconeCartao /> },
  { to: '/assinaturas', label: 'Assinaturas', icone: <IconeRepetir /> },
  { to: '/investimentos', label: 'Investir', icone: <IconeGrafico /> },
  { to: '/caixinha', label: 'Caixinha', icone: <IconeCaixa /> },
]

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-borda bg-fundo/85 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-lg">
        {abas.map(({ to, label, icone }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition ${isActive ? 'text-primaria' : 'text-texto-suave hover:text-texto'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition ${isActive ? 'bg-sucesso-fundo' : ''}`}
                  >
                    {icone}
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
