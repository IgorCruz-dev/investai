import { NavLink } from 'react-router'

const itens = [
  { to: '/', label: 'Início', icone: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { to: '/extrato', label: 'Extrato', icone: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3' },
  { to: '/lancar', label: 'Lançar', icone: 'M12 5v14M5 12h14', destaque: true },
  { to: '/relatorio', label: 'Relatório', icone: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { to: '/ajustes', label: 'Ajustes', icone: 'M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4' },
]

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-lg justify-around">
        {itens.map(({ to, label, icone, destaque }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2 text-xs ${isActive ? 'text-primaria' : 'text-texto-suave'}`
              }
            >
              <span
                className={`flex items-center justify-center ${destaque ? 'h-9 w-9 rounded-full bg-primaria text-superficie' : 'h-6 w-6'}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={icone} />
                </svg>
              </span>
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
