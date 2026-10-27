import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import Esqueleto from '../../components/Esqueleto'
import { formatarDataHora, formatarMoeda } from '../../lib/formatar'
import {
  aceitarPlano,
  carregarOnboarding,
  pedirRecomendacao,
  type Job,
  type Plano,
  type VetoNoticia,
} from '../../services/onboarding'

const nomeDaClasse: Record<string, string> = {
  acao: 'Ações', etf: 'ETFs', fii: 'FIIs', renda_fixa: 'Renda fixa',
}
const tickerLegivel = (ticker: string) => ticker.replace(/\.SA$/, '')

function BlocoVeto({ veto, tirado }: { veto: VetoNoticia; tirado: boolean }) {
  return (
    <li className="rounded-xl border border-borda bg-superficie p-3.5">
      <p className="text-sm font-semibold">
        {tickerLegivel(veto.ticker)} · <span className="font-normal text-texto-suave">{veto.motivo}</span>
      </p>
      <p className="mt-1 text-sm italic text-texto-suave">&ldquo;{veto.frase}&rdquo;</p>
      <p className="mt-1.5 text-xs text-texto-suave">
        {veto.fonte || 'fonte não identificada'}
        {' · '}
        {tirado ? 'ficou fora da carteira' : 'mantido na carteira, só como alerta'}
      </p>
    </li>
  )
}

export default function CarteiraSugerida() {
  const navegar = useNavigate()
  const [plano, setPlano] = useState<Plano | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [respondido, setRespondido] = useState(true)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)
  const [aceitando, setAceitando] = useState(false)

  useEffect(() => {
    let ativo = true
    carregarOnboarding()
      .then((dados) => {
        if (!ativo) return
        setPlano(dados.plano)
        setJob(dados.job)
        setRespondido(dados.respondido)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar a carteira sugerida.'))
      .finally(() => ativo && setCarregando(false))
    return () => { ativo = false }
  }, [versao])

  // Enquanto a VM calcula, a tela se consulta de novo. É o mesmo polling da aba
  // Investimentos, e é a contrapartida de o cálculo não morar aqui.
  const calculando = job?.estado === 'pendente' || job?.estado === 'rodando'
  useEffect(() => {
    if (!calculando) return
    const intervalo = window.setInterval(() => setVersao((n) => n + 1), 10_000)
    return () => window.clearInterval(intervalo)
  }, [calculando])

  async function pedir() {
    try {
      await pedirRecomendacao()
      setVersao((n) => n + 1)
    } catch {
      setErro('Não foi possível pedir o cálculo à VM.')
    }
  }

  async function aceitar() {
    if (!plano) return
    setAceitando(true)
    try {
      await aceitarPlano(plano.planoId)
      setVersao((n) => n + 1)
    } catch {
      setErro('Não foi possível marcar o plano como aceito.')
    } finally {
      setAceitando(false)
    }
  }

  if (carregando) {
    return <div className="space-y-4"><Esqueleto className="h-8 w-64" /><Esqueleto className="h-72" /></div>
  }

  if (!respondido) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Carteira sugerida</h1>
        <Card className="mt-6">
          <p className="font-medium">Primeiro o perfil</p>
          <p className="mt-1 text-sm text-texto-suave">
            Sem as 18 respostas não há alocação-alvo, e sem alocação-alvo não há carteira.
            São quatro blocos curtos.
          </p>
          <div className="mt-5"><Botao onClick={() => navegar('/onboarding')}>Responder o perfil</Botao></div>
        </Card>
      </>
    )
  }

  const total = plano?.posicoes.reduce((soma, p) => soma + p.valor, 0) ?? 0
  const bloqueantes = plano?.prerequisitos.filter((p) => p.bloqueia) ?? []
  const atencao = plano?.prerequisitos.filter((p) => !p.bloqueia) ?? []

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Carteira sugerida</h1>
          <p className="mt-1 text-sm text-texto-suave">
            Montada por cálculo sobre dados de mercado. Nenhum número daqui saiu de um modelo.
          </p>
        </div>
        <button
          onClick={pedir}
          disabled={calculando}
          className="font-semibold text-primaria hover:underline disabled:opacity-50"
        >
          {calculando ? 'Calculando…' : 'Recalcular'}
        </button>
      </div>

      {erro && <div className="mt-5"><Alerta>{erro}</Alerta></div>}

      {/* Pré-requisito é porteiro, não bloqueio (spec 002): aparece antes da
          carteira, inclusive quando é bloqueante — e nunca impede o uso. */}
      {bloqueantes.length > 0 && (
        <div className="mt-6">
          <Alerta>
            <span className="block font-semibold">Antes de comprar ação</span>
            <ul className="mt-1.5 space-y-1">
              {bloqueantes.map((p) => (
                <li key={p.titulo}>
                  {p.titulo}
                  {p.valor > 0 && <> — {formatarMoeda(p.valor)}</>}
                  {p.detalhe && <span className="block text-sm opacity-80">{p.detalhe}</span>}
                </li>
              ))}
            </ul>
          </Alerta>
        </div>
      )}

      {calculando && (
        <Card className="mt-6">
          <p className="font-medium">Calculando sua carteira</p>
          <p className="mt-1 text-sm text-texto-suave">
            A VM está buscando os dados de mercado e aplicando os critérios do seu perfil.
            Leva até alguns minutos; esta tela se atualiza sozinha.
          </p>
        </Card>
      )}

      {!plano && !calculando && (
        <Card className="mt-6">
          <p className="font-medium">Nenhuma carteira calculada ainda</p>
          <p className="mt-1 text-sm text-texto-suave">
            {job?.estado === 'erro'
              ? 'A última tentativa falhou. Peça o cálculo de novo.'
              : 'Peça o cálculo e a VM monta a sugestão a partir do seu perfil.'}
          </p>
          <div className="mt-5"><Botao onClick={pedir}>Calcular agora</Botao></div>
        </Card>
      )}

      {plano && (
        <>
          <div className="destaque destaque-ouro mt-6 p-6 text-white">
            <p className="text-sm text-white/70">
              Perfil {plano.perfil.nome} · score {plano.perfil.score.toFixed(0)}/100
            </p>
            <p className="mt-2 font-display text-4xl tabular">{formatarMoeda(total)}</p>
            <p className="mt-2 text-xs text-white/65">
              {plano.posicoes.length === 0
                ? 'Nada a alocar em risco agora — veja o que vem antes.'
                : `Distribuídos em ${plano.posicoes.length} posição(ões).`}
              {plano.perfil.aporteMensal > 0 && <> Aporte mensal declarado: {formatarMoeda(plano.perfil.aporteMensal)}.</>}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-texto-suave">
            <span>Calculada em {formatarDataHora(plano.geradoEm)}</span>
            {plano.aceitoEm && <span>Aceita em {formatarDataHora(plano.aceitoEm)}</span>}
          </div>

          {plano.incompleta && plano.aviso && (
            <div className="mt-4"><Alerta>{plano.aviso}</Alerta></div>
          )}

          {/* Degradação honesta da spec 003: a carteira é a mesma, o que faltou
              foi a camada de proteção — e dizer isso é obrigação. */}
          {!plano.triagemOk && (
            <p className="mt-4 rounded-xl border border-borda bg-superficie-2 p-3.5 text-xs text-texto-suave">
              Sem triagem de notícia nesta rodada{plano.triagemMotivo ? ` (${plano.triagemMotivo})` : ''}.
              Os ativos abaixo passaram pelos critérios numéricos, mas ninguém leu as notícias
              recentes deles.
            </p>
          )}

          {/* A mensagem do pré-requisito diz "a alocação-alvo abaixo passa a
              valer" — então ela precisa estar visível, inclusive (e sobretudo)
              quando não há nenhuma posição para mostrar. */}
          {Object.keys(plano.perfil.alocacao).length > 0 && (
            <Card titulo="Sua alocação-alvo" className="mt-6">
              <ul className="space-y-3">
                {Object.entries(plano.perfil.alocacao)
                  .filter(([, peso]) => peso > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([classe, peso]) => (
                    <li key={classe}>
                      <div className="flex justify-between text-sm">
                        <span>{nomeDaClasse[classe] ?? classe}</span>
                        <span className="font-mono">{peso.toFixed(0)}%</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-superficie-3">
                        <div className="h-full rounded-full bg-primaria" style={{ width: `${Math.min(peso, 100)}%` }} />
                      </div>
                    </li>
                  ))}
              </ul>
              {plano.perfil.notas.length > 0 && (
                <ul className="mt-4 space-y-1.5 text-xs text-texto-suave">
                  {plano.perfil.notas.map((nota) => <li key={nota}>{nota}</li>)}
                </ul>
              )}
            </Card>
          )}

          {plano.posicoes.length > 0 && <Card titulo="Posições sugeridas" className="mt-6" semEspaco>
            <ul className="divide-y divide-borda">
              {plano.posicoes.map((p) => {
                const alerta = plano.alertas.find((v) => v.ticker === p.ticker)
                return (
                  <li key={p.ticker} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{tickerLegivel(p.ticker)}</p>
                        <p className="text-xs text-texto-suave">
                          {p.nome}{p.setor ? ` · ${p.setor}` : ''} · {nomeDaClasse[p.classe] ?? p.classe}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm">{formatarMoeda(p.valor)}</p>
                        <p className="text-xs text-texto-suave">
                          {p.pesoPct.toFixed(1)}%
                          {p.preco !== null && <> · {p.cotas.toLocaleString('pt-BR')} × {formatarMoeda(p.preco)}</>}
                        </p>
                      </div>
                    </div>
                    {p.justificativa && (
                      <p className="mt-2 text-xs text-texto-suave">{p.justificativa}</p>
                    )}
                    {alerta && (
                      <p className="mt-2 rounded-lg bg-superficie-2 p-2.5 text-xs">
                        <strong>Alerta de notícia:</strong> {alerta.motivo}. Ficou na carteira porque
                        tirá-lo deixaria a classe sem nenhum ativo aprovado.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>}

          {plano.vetos.length > 0 && (
            <Card titulo="Tirados por notícia" className="mt-6">
              <p className="mb-3 text-xs text-texto-suave">
                Estes passaram nos números e saíram por notícia grave. O critério e a frase ficam
                registrados: a sugestão de hoje pode não se repetir amanhã, mas continua explicável.
              </p>
              <ul className="space-y-2">
                {plano.vetos.map((v) => <BlocoVeto key={v.ticker} veto={v} tirado />)}
              </ul>
            </Card>
          )}

          {atencao.length > 0 && (
            <Card titulo="Pontos de atenção" className="mt-6">
              <ul className="space-y-2 text-sm">
                {atencao.map((p) => (
                  <li key={p.titulo}>
                    <span className="font-medium">{p.titulo}</span>
                    {p.valor > 0 && <> — {formatarMoeda(p.valor)}</>}
                    {p.detalhe && <span className="block text-xs text-texto-suave">{p.detalhe}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {Object.keys(plano.rejeitados).length > 0 && (
            <Card titulo="Por que os outros ficaram fora" className="mt-6">
              <p className="mb-3 text-xs text-texto-suave">
                Uma recomendação que só diz o que comprar é caixa preta. Aqui está o critério que
                cada ativo não cumpriu — é o que te deixa discordar dela.
              </p>
              <div className="space-y-4">
                {Object.entries(plano.rejeitados).map(([classe, linhas]) => (
                  <div key={classe}>
                    <p className="text-sm font-semibold">{nomeDaClasse[classe] ?? classe}</p>
                    <ul className="mt-1.5 space-y-1 text-xs text-texto-suave">
                      {linhas.map((linha) => <li key={linha}>{linha}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {plano.riscos && (
            <Card titulo="Riscos desta carteira" className="mt-6">
              <p className="whitespace-pre-line text-sm text-texto-suave">{plano.riscos}</p>
            </Card>
          )}

          {plano.posicoes.length > 0 && <Card className="mt-6">
            <p className="font-semibold">Aceitar não compra nada</p>
            <p className="mt-1 text-sm text-texto-suave">
              A compra acontece na corretora, e pode sair por outro preço, em parte, ou nunca.
              Marcar como aceita guarda esta lista como conferência — a posição só nasce quando
              você declarar a compra em <Link to="/investimentos" className="font-semibold text-primaria hover:underline">Investimentos</Link>.
            </p>
            {plano.proximosPassos.length > 0 && (
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-texto-suave">
                {plano.proximosPassos.map((passo) => <li key={passo}>{passo}</li>)}
              </ul>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Botao onClick={aceitar} carregando={aceitando} disabled={!!plano.aceitoEm}>
                {plano.aceitoEm ? 'Plano aceito' : 'Aceitar como lista de conferência'}
              </Botao>
              <Botao variante="secundaria" onClick={() => navegar('/investimentos')} disabled={aceitando}>
                Ir registrar uma compra
              </Botao>
            </div>
          </Card>}
        </>
      )}
    </>
  )
}
