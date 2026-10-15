import { Navigate, Route, Routes } from 'react-router'
import RotaProtegida from './components/RotaProtegida'
import Login from './pages/login/Login'
import Cadastro from './pages/cadastro/Cadastro'
import Dashboard from './pages/dashboard/Dashboard'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Cadastro />} />

      {/* Telas que exigem login */}
      <Route element={<RotaProtegida />}>
        <Route path="/dashboard" element={<Dashboard />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
