import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../hooks/useAuth'

/** Só deixa passar quem está logado; os outros vão para o login. */
export default function RotaProtegida() {
  const { usuario, carregando } = useAuth()

  if (carregando) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-3 border-emerald-100 border-t-primaria" />
      </div>
    )
  }
  if (!usuario) return <Navigate to="/login" replace />
  return <Outlet />
}
