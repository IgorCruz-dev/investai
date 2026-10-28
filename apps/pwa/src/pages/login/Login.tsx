import { useState, type SubmitEvent } from 'react'
import { Link, Navigate } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Campo from '../../components/Campo'
import { IconeCadeado, IconeEmail } from '../../components/icones'
import { useAuth } from '../../hooks/useAuth'
import AuthLayout from '../../layouts/AuthLayout'
import { entrar } from '../../services/auth'

export default function Login() {
  const { usuario, carregando } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function aoEnviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await entrar(email, senha)
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  if (carregando) return null
  // Já logado (ou acabou de entrar): vai para o dashboard
  if (usuario) return <Navigate to="/dashboard" replace />

  return (
    <AuthLayout
      titulo="Bem-vindo de volta"
      subtitulo="Entre na sua conta para continuar."
      rodape={
        <>
          Não tem conta?{' '}
          <Link to="/cadastro" className="font-semibold text-destaque hover:underline">
            Criar conta grátis
          </Link>
        </>
      }
    >
      <form onSubmit={aoEnviar} className="flex flex-col gap-5">
        <Campo
          id="email"
          label="E-mail"
          type="email"
          autoComplete="email"
          placeholder="voce@email.com"
          icone={<IconeEmail />}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Campo
          id="senha"
          label="Senha"
          type="password"
          autoComplete="current-password"
          placeholder="Sua senha"
          icone={<IconeCadeado />}
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />

        {erro && <Alerta>{erro}</Alerta>}

        <div className="mt-1">
          <Botao type="submit" carregando={enviando}>
            {enviando ? 'Entrando...' : 'Entrar'}
          </Botao>
        </div>
      </form>
    </AuthLayout>
  )
}
