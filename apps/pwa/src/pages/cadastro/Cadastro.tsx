import { useEffect, useState, type SubmitEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Campo from '../../components/Campo'
import { IconeCadeado, IconeEmail, IconeUsuario } from '../../components/icones'
import AuthLayout from '../../layouts/AuthLayout'
import { cadastrar, cadastroDisponivel } from '../../services/auth'

const SENHA_MINIMA = 6
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i

type Erros = Partial<Record<'nome' | 'email' | 'senha' | 'confirmacao', string>>

export default function Cadastro() {
  const navigate = useNavigate()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [tentouEnviar, setTentouEnviar] = useState(false)
  const [aguardandoConfirmacao, setAguardandoConfirmacao] = useState(false)
  const [cadastroAberto, setCadastroAberto] = useState<boolean | null>(null)

  useEffect(() => {
    cadastroDisponivel().then(setCadastroAberto).catch(() => setErro('Não foi possível conferir se o cadastro está disponível.'))
  }, [])

  function validar(): Erros {
    const erros: Erros = {}
    if (!nome.trim()) erros.nome = 'Informe seu nome.'

    if (!email.trim()) erros.email = 'Informe seu e-mail.'
    else if (!EMAIL_VALIDO.test(email.trim())) erros.email = 'Informe um e-mail válido.'

    if (!senha) erros.senha = 'Crie uma senha.'
    else if (senha.length < SENHA_MINIMA) erros.senha = `A senha precisa ter no mínimo ${SENHA_MINIMA} caracteres.`

    if (!confirmacao) erros.confirmacao = 'Repita a senha.'
    else if (senha !== confirmacao) erros.confirmacao = 'As senhas não conferem.'
    return erros
  }

  // Os erros só aparecem depois da primeira tentativa de enviar; daí em diante atualizam enquanto a pessoa digita
  const erros = tentouEnviar ? validar() : {}

  async function aoEnviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setErro('')
    setTentouEnviar(true)
    if (Object.keys(validar()).length > 0) return

    setEnviando(true)
    try {
      const contaAtiva = await cadastrar(nome.trim(), email.trim(), senha)
      if (contaAtiva) navigate('/dashboard')
      else setAguardandoConfirmacao(true)
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  if (aguardandoConfirmacao) {
    return (
      <AuthLayout
        titulo="Confira seu e-mail"
        subtitulo={
          <>
            Enviamos um link de confirmação para <strong className="font-medium text-texto">{email}</strong>. Depois de
            confirmar, é só entrar.
          </>
        }
      >
        <Link
          to="/login"
          className="flex h-12 w-full items-center justify-center rounded-xl bg-primaria font-semibold text-sobre-primaria shadow-lg shadow-primaria/25 transition hover:bg-primaria-escura"
        >
          Ir para o login
        </Link>
      </AuthLayout>
    )
  }

  if (cadastroAberto === false) {
    return <AuthLayout titulo="Instância já configurada" subtitulo="Esta instalação do InvestAI já tem uma conta.">
      <Link to="/login" className="font-semibold text-primaria hover:underline">Ir para o login</Link>
    </AuthLayout>
  }

  return (
    <AuthLayout
      titulo="Crie sua conta"
      subtitulo="Leva menos de um minuto."
      rodape={
        <>
          Já tem conta?{' '}
          <Link to="/login" className="font-semibold text-primaria hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={aoEnviar} noValidate className="flex flex-col gap-5">
        <Campo
          id="nome"
          label="Nome"
          autoComplete="name"
          placeholder="Como quer ser chamado"
          icone={<IconeUsuario />}
          required
          erro={erros.nome}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <Campo
          id="email"
          label="E-mail"
          type="email"
          autoComplete="email"
          placeholder="seunome@gmail.com"
          icone={<IconeEmail />}
          required
          erro={erros.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Campo
          id="senha"
          label="Senha"
          type="password"
          autoComplete="new-password"
          placeholder={`Mínimo de ${SENHA_MINIMA} caracteres`}
          minLength={SENHA_MINIMA}
          icone={<IconeCadeado />}
          required
          erro={erros.senha}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
        <Campo
          id="confirmacao"
          label="Confirmar senha"
          type="password"
          autoComplete="new-password"
          placeholder="Repita a senha"
          icone={<IconeCadeado />}
          required
          erro={erros.confirmacao}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />

        {erro && <Alerta>{erro}</Alerta>}

        <div className="mt-1">
          <Botao type="submit" carregando={enviando}>
            {enviando ? 'Criando conta...' : 'Criar conta'}
          </Botao>
        </div>
      </form>
    </AuthLayout>
  )
}
