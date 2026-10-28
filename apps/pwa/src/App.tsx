import { Navigate, Route, Routes } from 'react-router'
import RotaProtegida from './components/RotaProtegida'
import AppLayout from './layouts/AppLayout'
import Login from './pages/login/Login'
import Cadastro from './pages/cadastro/Cadastro'
import Dashboard from './pages/dashboard/Dashboard'
import Cartoes from './pages/cartoes/Cartoes'
import DetalheCartao from './pages/detalhe-cartao/DetalheCartao'
import Assinaturas from './pages/assinaturas/Assinaturas'
import Comparativo from './pages/comparativo/Comparativo'
import Investimentos from './pages/investimentos/Investimentos'
import Lancamentos from './pages/lancamentos/Lancamentos'
import Bancos from './pages/bancos/Bancos'
import CategoriasDoBanco from './pages/bancos/CategoriasDoBanco'
import Acertos from './pages/acertos/Acertos'
import Notificacoes from './pages/notificacoes/Notificacoes'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Cadastro />} />

      {/* Telas que exigem login, todas dentro do AppLayout (barra do topo + navegação embaixo) */}
      <Route element={<RotaProtegida />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/cartoes" element={<Cartoes />} />
          <Route path="/cartoes/:id" element={<DetalheCartao />} />
          <Route path="/assinaturas" element={<Assinaturas />} />
          <Route path="/comparativo" element={<Comparativo />} />
          <Route path="/investimentos" element={<Investimentos />} />
          {/* A Caixinha virou Investimentos */}
          <Route path="/caixinha" element={<Navigate to="/investimentos" replace />} />
          <Route path="/lancamentos" element={<Lancamentos />} />
          <Route path="/bancos" element={<Bancos />} />
          <Route path="/bancos/categorias" element={<CategoriasDoBanco />} />
          <Route path="/acertos" element={<Acertos />} />
          <Route path="/notificacoes" element={<Notificacoes />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
