import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import Esqueleto from '../../components/Esqueleto'
import { IconeGrafico, IconeMais } from '../../components/icones'
import { formatarMoeda } from '../../lib/formatar'
import {
  blocos,
  carregarOnboarding,
  importarCarteira,
  lerCarteiraColada,
  pedirRecomendacao,
  perguntas,
  perguntaTemCarteira,
  salvarRespostas,
  type Pergunta,
  type Respostas,
} from '../../services/onboarding'

/** Rascunho no navegador: 18 perguntas é muita coisa para perder num F5.
 *  Só rascunho — a resposta de verdade vive no banco. */
const RASCUNHO = 'investai:onboarding:rascunho'

type Etapa = 'perguntas' | 'bifurcacao' | 'importar'

function lerRascunho(): Respostas {
  try {
    const bruto = localStorage.getItem(RASCUNHO)
    const dados = bruto ? JSON.parse(bruto) : null
    return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {}
  } catch {
    return {}
  }
}

function respondida(pergunta: Pergunta, valor: Respostas[string] | undefined): boolean {
  if (!pergunta.obrigatoria) return true
  if (valor === undefined || valor === '') return false
  if (Array.isArray(valor)) return valor.length > 0
  return true
}

export default function Onboarding() {
  const navegar = useNavigate()
  const [carregando, setCarregando] = useState(true)
  const [etapa, setEtapa] = useState<Etapa>('perguntas')
  const [indice, setIndice] = useState(0)
  const [respostas, setRespostas] = useState<Respostas>(lerRascunho)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [colado, setColado] = useState('')

  useEffect(() => {
    carregarOnboarding()
      .then((dados) => {
        // Quem já respondeu volta para as respostas gravadas, não para o rascunho.
        if (dados.respondido && dados.respostas) setRespostas(dados.respostas)
      })
      .catch(() => setErro('Não foi possível carregar seu perfil. Tente de novo.'))
      .finally(() => setCarregando(false))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(RASCUNHO, JSON.stringify(respostas))
    } catch {
      // Navegador sem armazenamento: o rascunho é conveniência, não requisito.
    }
  }, [respostas])

  const pergunta = perguntas[indice]
  const bloco = useMemo(
    () => blocos.find((b) => b.chave === pergunta?.bloco),
    [pergunta?.bloco],
  )
  const faltando = perguntas.filter((p) => !respondida(p, respostas[p.chave]))

  function responder(valor: Respostas[string]) {
    setRespostas((atuais) => ({ ...atuais, [pergunta.chave]: valor }))
  }

  function alternar(valor: string) {
    setRespostas((atuais) => {
      const atual = atuais[pergunta.chave]
      const lista = Array.isArray(atual) ? atual : []
      return {
        ...atuais,
        [pergunta.chave]: lista.includes(valor)
          ? lista.filter((v) => v !== valor)
          : [...lista, valor],
      }
    })
  }

  async function concluir() {
    setSalvando(true)
    setErro('')
    try {
      await salvarRespostas(respostas)
      // O cálculo é da VM: ela deriva o perfil e monta a carteira. A espera é o
      // preço de não duplicar as regras de alocação aqui dentro.
      await pedirRecomendacao()
      try {
        localStorage.removeItem(RASCUNHO)
      } catch { /* rascunho é conveniência */ }
      setEtapa('bifurcacao')
    } catch {
      setErro('Não foi possível salvar suas respostas. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  async function importar() {
    setSalvando(true)
    setErro('')
    try {
      await importarCarteira(lerCarteiraColada(colado))
      navegar('/investimentos')
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) {
    return <div className="space-y-4"><Esqueleto className="h-8 w-56" /><Esqueleto className="h-64" /></div>
  }

  if (etapa === 'bifurcacao') {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Perfil respondido</h1>
        <p className="mt-1 text-sm text-texto-suave">
          Estou calculando sua alocação-alvo e a carteira sugerida. Enquanto isso:
        </p>
        {erro && <div className="mt-5"><Alerta>{erro}</Alerta></div>}

        <Card titulo={perguntaTemCarteira.enunciado} className="mt-6">
          <div className="space-y-3">
            <button
              onClick={() => setEtapa('importar')}
              className="flex w-full items-center gap-3 rounded-xl border border-borda bg-superficie p-4 text-left hover:border-primaria"
            >
              <IconeMais className="h-5 w-5 shrink-0 text-primaria" />
              <span>
                <span className="block font-semibold">Sim, já tenho ações, ETFs ou FIIs</span>
                <span className="block text-sm text-texto-suave">
                  Importo com ticker e quantidade. O resto eu completo.
                </span>
              </span>
            </button>
            <button
              onClick={() => navegar('/carteira-sugerida')}
              className="flex w-full items-center gap-3 rounded-xl border border-borda bg-superficie p-4 text-left hover:border-primaria"
            >
              <IconeGrafico className="h-5 w-5 shrink-0 text-primaria" />
              <span>
                <span className="block font-semibold">Ainda não comprei nada</span>
                <span className="block text-sm text-texto-suave">
                  Ver a carteira que o cálculo sugere para o meu perfil.
                </span>
              </span>
            </button>
          </div>
        </Card>
      </>
    )
  }

  if (etapa === 'importar') {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Importar sua carteira</h1>
        <p className="mt-1 text-sm text-texto-suave">
          Uma linha por ativo: ticker e quantidade. O preço médio é opcional.
        </p>
        {erro && <div className="mt-5"><Alerta>{erro}</Alerta></div>}

        <Card className="mt-6">
          <label className="block text-sm font-medium">
            Suas posições
            <textarea
              value={colado}
              onChange={(e) => setColado(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={'VALE3 100\nITUB4 250 32,80\nHGLG11 30'}
              className="mt-1.5 block w-full rounded-xl border border-borda bg-fundo px-3 py-3 font-mono text-sm"
            />
          </label>
          <p className="mt-3 text-xs text-texto-suave">
            Informar o preço médio faz o resultado ser real desde o primeiro dia. Sem ele, a
            posição entra pela cotação conhecida e o resultado só passa a significar algo dali
            para frente — eu não invento um preço médio plausível, porque isso viraria um lucro
            falso em cima do qual você decidiria algo.
          </p>
          <p className="mt-2 text-xs text-texto-suave">
            Estas posições <strong>não</strong> geram despesa no seu mês: o dinheiro delas saiu
            antes do sistema existir.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Botao onClick={importar} carregando={salvando} disabled={!colado.trim()}>
              Importar posições
            </Botao>
            <Botao variante="secundaria" onClick={() => navegar('/carteira-sugerida')} disabled={salvando}>
              Pular e ver a sugestão
            </Botao>
          </div>
        </Card>
      </>
    )
  }

  const valor = respostas[pergunta.chave]
  const podeAvancar = respondida(pergunta, valor)
  const ultima = indice === perguntas.length - 1

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Seu perfil</h1>
        <span className="text-sm text-texto-suave">{indice + 1} de {perguntas.length}</span>
      </div>
      <p className="mt-1 text-sm text-texto-suave">{bloco?.titulo}</p>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-superficie-3">
        <div
          className="h-full rounded-full bg-primaria transition-all"
          style={{ width: `${((indice + 1) / perguntas.length) * 100}%` }}
        />
      </div>

      {erro && <div className="mt-5"><Alerta>{erro}</Alerta></div>}

      <Card className="mt-6">
        <p className="text-lg font-semibold">{pergunta.enunciado}</p>
        {pergunta.ajuda && <p className="mt-1.5 text-sm text-texto-suave">{pergunta.ajuda}</p>}

        <div className="mt-5 space-y-2">
          {pergunta.tipo === 'choice' && pergunta.opcoes?.map((opcao) => (
            <button
              key={opcao.valor}
              onClick={() => responder(opcao.valor)}
              className={`block w-full rounded-xl border p-3.5 text-left transition ${valor === opcao.valor ? 'border-primaria bg-sucesso-fundo' : 'border-borda bg-superficie hover:border-borda-forte'}`}
            >
              <span className="font-medium">{opcao.rotulo}</span>
              {opcao.ajuda && <span className="mt-0.5 block text-xs text-texto-suave">{opcao.ajuda}</span>}
            </button>
          ))}

          {pergunta.tipo === 'multi' && pergunta.opcoes?.map((opcao) => {
            const marcada = Array.isArray(valor) && valor.includes(opcao.valor)
            return (
              <button
                key={opcao.valor}
                onClick={() => alternar(opcao.valor)}
                aria-pressed={marcada}
                className={`block w-full rounded-xl border p-3.5 text-left transition ${marcada ? 'border-primaria bg-sucesso-fundo' : 'border-borda bg-superficie hover:border-borda-forte'}`}
              >
                <span className="font-medium">{opcao.rotulo}</span>
                {opcao.ajuda && <span className="mt-0.5 block text-xs text-texto-suave">{opcao.ajuda}</span>}
              </button>
            )
          })}

          {pergunta.tipo === 'scale' && (
            <div>
              <input
                type="range"
                min={pergunta.minimo ?? 1}
                max={pergunta.maximo ?? 10}
                step={pergunta.passo ?? 1}
                value={typeof valor === 'number' ? valor : Math.round(((pergunta.minimo ?? 1) + (pergunta.maximo ?? 10)) / 2)}
                onChange={(e) => responder(Number(e.target.value))}
                className="w-full accent-primaria"
              />
              <p className="mt-2 text-center font-display text-3xl tabular">
                {typeof valor === 'number' ? valor : '—'}
              </p>
              {typeof valor !== 'number' && (
                // O polegar do slider sempre aparece em alguma posição, o que
                // faz parecer que já há resposta. Sem este aviso, o botão
                // desabilitado não tem explicação na tela.
                <p className="text-center text-xs text-texto-suave">
                  Arraste para dar sua nota de {pergunta.minimo ?? 1} a {pergunta.maximo ?? 10}.
                </p>
              )}
            </div>
          )}

          {pergunta.tipo === 'number' && (
            <div>
              <input
                type="number"
                inputMode="decimal"
                min={pergunta.minimo ?? 0}
                max={pergunta.maximo}
                step={pergunta.passo ?? 100}
                value={typeof valor === 'number' ? valor : ''}
                onChange={(e) => responder(e.target.value === '' ? '' : Number(e.target.value))}
                className="block w-full rounded-xl border border-borda bg-fundo px-3 py-3 text-lg tabular"
              />
              {typeof valor === 'number' && valor > 0 && (
                <p className="mt-2 text-sm text-texto-suave">{formatarMoeda(valor)}</p>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="mt-5 flex gap-3">
        <Botao
          variante="secundaria"
          onClick={() => setIndice((n) => Math.max(0, n - 1))}
          disabled={indice === 0 || salvando}
        >
          Voltar
        </Botao>
        {ultima ? (
          <Botao onClick={concluir} carregando={salvando} disabled={faltando.length > 0}>
            {faltando.length > 0 ? `Faltam ${faltando.length} resposta(s)` : 'Concluir'}
          </Botao>
        ) : (
          <Botao onClick={() => setIndice((n) => n + 1)} disabled={!podeAvancar}>
            Continuar
          </Botao>
        )}
      </div>

      {faltando.length > 0 && ultima && (
        <button
          onClick={() => setIndice(perguntas.indexOf(faltando[0]))}
          className="mt-3 text-sm font-semibold text-primaria hover:underline"
        >
          Ir para a primeira pergunta sem resposta
        </button>
      )}
    </>
  )
}
