import { useEffect, useMemo, useState, type SubmitEvent } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import Esqueleto from '../../components/Esqueleto'
import Modal from '../../components/Modal'
import { IconeGrafico, IconeMais } from '../../components/icones'
import { hojeISO } from '../../lib/datas'
import { formatarDataHora, formatarDia, formatarMoeda } from '../../lib/formatar'
import { carregarInvestimentos, excluirMovimento, pedirAtualizacao, salvarMovimento, type Ativo, type Job, type Movimentacao, type MovimentoNovo, type Posicao, type SnapshotInvestimentos } from '../../services/investimentos'

const vazio = (): MovimentoNovo => ({ tipo: 'compra', ticker: '', classe: 'acao', shares: 0, preco: 0, taxas: 0, data: hojeISO() })
const tickerLegivel = (ticker: string) => ticker.replace(/\.SA$/, '')

export default function CarteiraDeclarada() {
  const [ativos, setAtivos] = useState<Ativo[]>([])
  const [posicoes, setPosicoes] = useState<Posicao[]>([])
  const [movimentos, setMovimentos] = useState<Movimentacao[]>([])
  const [snapshot, setSnapshot] = useState<SnapshotInvestimentos | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [metas, setMetas] = useState<Record<string, number>>({})
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)
  const [formulario, setFormulario] = useState<MovimentoNovo | null>(null)
  const [editando, setEditando] = useState<number | undefined>()
  const [salvando, setSalvando] = useState(false)
  const [erroFormulario, setErroFormulario] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    carregarInvestimentos()
      .then((dados) => {
        if (!ativo) return
        setAtivos(dados.ativos)
        setPosicoes(dados.posicoes)
        setMovimentos(dados.movimentos)
        setSnapshot(dados.snapshot)
        setJob(dados.job)
        setMetas(dados.metas)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar os investimentos. Confira se as migrações foram aplicadas.'))
      .finally(() => ativo && setCarregando(false))
    return () => { ativo = false }
  }, [versao])

  useEffect(() => {
    if (job?.estado !== 'pendente' && job?.estado !== 'rodando') return
    const intervalo = window.setInterval(() => setVersao((n) => n + 1), 10_000)
    return () => window.clearInterval(intervalo)
  }, [job?.estado])

  const catalogo = useMemo(() => new Map(ativos.map((a) => [a.ticker, a])), [ativos])
  const posicoesAtivas = posicoes.filter((p) => Number(p.shares) > 0)
  const custo = posicoesAtivas.reduce((soma, p) => soma + Number(p.custo_total), 0)
  const realizado = posicoes.reduce((soma, p) => soma + Number(p.pnl_realizado), 0)
  const valoresAtuais = posicoesAtivas.map((p) => {
    const calculado = snapshot?.posicoes.get(p.ticker)
    return calculado?.shares === Number(p.shares) ? calculado.value : null
  })
  const valorAtual = valoresAtuais.every((v) => v !== null) && posicoesAtivas.length > 0
    ? valoresAtuais.reduce<number>((soma, v) => soma + (v ?? 0), 0) : null
  const classes = [
    { chave: 'acao', nome: 'Ações' },
    { chave: 'etf', nome: 'ETFs' },
    { chave: 'fii', nome: 'FIIs' },
  ]
  const totalBolsa = custo
  const alvoBolsa = classes.reduce((soma, c) => soma + (metas[c.chave] ?? 0), 0)

  // Concentração (spec 002, item 3c): quem já tem carteira quer saber o que está
  // errado na que tem, e "um ativo é 60% de tudo" é o risco que não aparece em
  // nenhum outro número desta tela. Por custo, como o resto da comparação.
  const maiorPosicao = posicoesAtivas.reduce<{ ticker: string; valor: number } | null>(
    (maior, p) => {
      const valor = Number(p.custo_total)
      return !maior || valor > maior.valor ? { ticker: p.ticker, valor } : maior
    }, null)
  const porSetor = new Map<string, number>()
  for (const p of posicoesAtivas) {
    const setor = catalogo.get(p.ticker)?.setor || 'Sem setor'
    porSetor.set(setor, (porSetor.get(setor) ?? 0) + Number(p.custo_total))
  }
  const maiorSetor = [...porSetor.entries()].sort((a, b) => b[1] - a[1])[0] ?? null

  async function atualizar() {
    try {
      await pedirAtualizacao()
      setVersao((n) => n + 1)
    } catch {
      setErro('Não foi possível pedir atualização à VM.')
    }
  }

  function abrir(m?: Movimentacao) {
    setEditando(m?.id)
    setFormulario(m ? {
      tipo: m.tipo as 'compra' | 'venda', ticker: tickerLegivel(m.ticker),
      classe: (catalogo.get(m.ticker)?.classe as MovimentoNovo['classe']) || 'acao',
      shares: Number(m.shares), preco: Number(m.preco), taxas: Number(m.taxas), data: m.data,
    } : vazio())
    setErroFormulario('')
  }

  async function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!formulario) return
    setSalvando(true)
    setErroFormulario('')
    try {
      await salvarMovimento(formulario, editando)
      setFormulario(null)
      setVersao((n) => n + 1)
    } catch (e) {
      setErroFormulario((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(m: Movimentacao) {
    if (!window.confirm(`Excluir ${m.tipo} de ${tickerLegivel(m.ticker)}? O lançamento financeiro correspondente também será excluído.`)) return
    try {
      await excluirMovimento(m.id)
      setVersao((n) => n + 1)
    } catch {
      setErro('Não foi possível excluir a movimentação.')
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Carteira de bolsa declarada</h2>
          <p className="mt-1 text-sm text-texto-suave">Posições calculadas a partir das compras e vendas que você registrou.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/carteira-sugerida" className="rounded-xl border border-borda px-4 py-2.5 text-sm font-semibold hover:border-borda-forte">
            Carteira sugerida
          </Link>
          <button onClick={() => abrir()} className="flex items-center gap-2 rounded-xl bg-primaria px-4 py-2.5 text-sm font-semibold text-sobre-primaria hover:bg-primaria-escura">
            <IconeMais className="h-4 w-4" /> Registrar
          </button>
        </div>
      </div>

      {erro && <div className="mt-5"><Alerta>{erro}</Alerta></div>}

      <div className="destaque destaque-ouro mt-6 p-6 text-white">
        <p className="text-sm text-white/70">Capital aplicado</p>
        {carregando ? <Esqueleto className="mt-3 h-10 w-44" /> : <p className="mt-2 font-display text-4xl tabular">{formatarMoeda(custo)}</p>}
        <p className="mt-2 text-xs text-white/65">{valorAtual === null ? 'Ainda sem valor de mercado atualizado.' : `Valor de mercado no último cálculo: ${formatarMoeda(valorAtual)}.`} Resultado realizado: {formatarMoeda(realizado)}.</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-texto-suave">
        <span>{snapshot ? `Último cálculo: ${formatarDataHora(snapshot.geradoEm)}` : 'Nenhum cálculo de mercado publicado ainda.'}{job?.estado === 'pendente' || job?.estado === 'rodando' ? ' · Atualização em andamento' : job?.estado === 'erro' ? ' · Última atualização falhou; tente novamente' : ''}</span>
        <button onClick={atualizar} disabled={job?.estado === 'pendente' || job?.estado === 'rodando'} className="font-semibold text-primaria hover:underline disabled:opacity-50">Atualizar dados</button>
      </div>

      <Card titulo="Posições" className="mt-6" semEspaco>
        {carregando ? <div className="p-5"><Esqueleto className="h-32" /></div> : posicoesAtivas.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <IconeGrafico className="mx-auto h-8 w-8 text-primaria" />
            <p className="mt-3 font-medium">Nenhuma posição registrada</p>
            {/* O estado vazio antes só sabia dizer "registre uma compra", que é
                inútil para quem ainda não tem o que registrar — e esse é o caso
                mais importante do produto (spec 002). Agora ele oferece os dois
                caminhos reais. */}
            <p className="mx-auto mt-1 max-w-sm text-sm text-texto-suave">
              Se você já tem ações, importe o que tem. Se ainda não comprou nada, responda as
              18 perguntas do perfil e eu calculo uma carteira para você.
            </p>
            <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link to="/onboarding" className="rounded-xl bg-primaria px-4 py-2.5 text-sm font-semibold text-sobre-primaria hover:bg-primaria-escura">
                Responder o perfil
              </Link>
              <Link to="/carteira-sugerida" className="rounded-xl border border-borda px-4 py-2.5 text-sm font-semibold hover:border-borda-forte">
                Ver carteira sugerida
              </Link>
            </div>
            <p className="mt-4 text-xs text-texto-suave">
              Ou registre uma compra que você já executou na corretora.
            </p>
          </div>
        ) : <ul className="divide-y divide-borda">{posicoesAtivas.map((p) => {
          const calculado = snapshot?.posicoes.get(p.ticker)
          const atualizado = calculado?.shares === Number(p.shares)
          return <li key={p.ticker} className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="font-semibold">{tickerLegivel(p.ticker)}</p>
              <p className="text-xs text-texto-suave">{catalogo.get(p.ticker)?.nome || catalogo.get(p.ticker)?.classe || 'Ativo'} · {Number(p.shares).toLocaleString('pt-BR')} cotas{catalogo.get(p.ticker)?.invalido ? ' · ticker não encontrado' : catalogo.get(p.ticker)?.validado ? '' : ' · aguardando validação'}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm">{formatarMoeda(Number(p.custo_total))}</p>
              <p className="text-xs text-texto-suave">PM {p.avg_price === null ? '—' : formatarMoeda(Number(p.avg_price))}</p>
              {atualizado && calculado?.value !== null && <p className="text-xs text-primaria">Atual {formatarMoeda(calculado.value ?? 0)}</p>}
            </div>
          </li>
        })}</ul>}
      </Card>

      {Object.keys(metas).length > 0 && totalBolsa > 0 && alvoBolsa > 0 && <Card titulo="Divisão da carteira em bolsa" className="mt-6">
        <p className="mb-4 text-xs text-texto-suave">Compara apenas ações, ETFs e FIIs cadastrados pelo custo. Renda fixa e saldo da conta ficam fora desta comparação.</p>
        <ul className="space-y-3">{classes.map((c) => {
          const atual = posicoesAtivas.filter((p) => catalogo.get(p.ticker)?.classe === c.chave).reduce((soma, p) => soma + Number(p.custo_total), 0) / totalBolsa * 100
          const alvo = (metas[c.chave] ?? 0) / alvoBolsa * 100
          return <li key={c.chave}>
            <div className="flex justify-between text-sm"><span>{c.nome}</span><span className="font-mono">{atual.toFixed(1)}% <span className="text-texto-suave">/ alvo {alvo.toFixed(1)}%</span></span></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-superficie-3"><div className="h-full rounded-full bg-primaria" style={{ width: `${Math.min(atual, 100)}%` }} /></div>
          </li>
        })}</ul>
        {(maiorPosicao || maiorSetor) && (
          <div className="mt-5 border-t border-borda pt-4 text-xs text-texto-suave">
            <p className="font-semibold text-texto">Concentração</p>
            {maiorPosicao && (
              <p className="mt-1">
                Maior posição: {tickerLegivel(maiorPosicao.ticker)} com{' '}
                {(maiorPosicao.valor / totalBolsa * 100).toFixed(1)}% do que está em bolsa.
              </p>
            )}
            {maiorSetor && (
              <p className="mt-0.5">Maior setor: {maiorSetor[0]} com {(maiorSetor[1] / totalBolsa * 100).toFixed(1)}%.</p>
            )}
          </div>
        )}
      </Card>}

      <Card titulo="Movimentações" className="mt-6" semEspaco>
        {carregando ? <div className="p-5"><Esqueleto className="h-32" /></div> : movimentos.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-texto-suave">Nenhuma movimentação ainda.</p>
        ) : <ul className="divide-y divide-borda">{movimentos.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <p className="font-medium">{m.tipo === 'compra' ? 'Compra' : m.tipo === 'venda' ? 'Venda' : 'Ajuste'} de {tickerLegivel(m.ticker)}</p>
              <p className="text-xs text-texto-suave">{formatarDia(m.data)} · {Number(m.shares).toLocaleString('pt-BR')} × {formatarMoeda(Number(m.preco))}{Number(m.taxas) > 0 ? ` · taxas ${formatarMoeda(Number(m.taxas))}` : ''}</p>
            </div>
            {m.origem === 'web' && <div className="flex shrink-0 gap-3 text-xs">
              <button onClick={() => abrir(m)} className="text-primaria hover:underline">Editar</button>
              <button onClick={() => excluir(m)} className="text-erro-texto hover:underline">Excluir</button>
            </div>}
          </li>
        ))}</ul>}
      </Card>

      <Modal aberto={formulario !== null} aoFechar={() => !salvando && setFormulario(null)} titulo={editando === undefined ? 'Registrar movimentação' : 'Editar movimentação'}>
        {formulario && <form onSubmit={enviar} className="space-y-4 pb-2">
          <p className="text-sm text-texto-suave">Registre a operação depois de fazê-la na corretora. A compra cria uma despesa no mês; a venda cria uma receita.</p>
          <label className="block text-sm">Operação
            <select value={formulario.tipo} onChange={(e) => setFormulario({ ...formulario, tipo: e.target.value as 'compra' | 'venda' })} className="mt-1 block w-full rounded-xl border border-borda bg-fundo px-3 py-3">
              <option value="compra">Compra</option><option value="venda">Venda</option>
            </select>
          </label>
          <label className="block text-sm">Ticker
            <input required value={formulario.ticker} onChange={(e) => setFormulario({ ...formulario, ticker: e.target.value.toUpperCase() })} placeholder="VALE3" className="mt-1 block w-full rounded-xl border border-borda bg-fundo px-3 py-3 uppercase" />
          </label>
          <label className="block text-sm">Classe
            <select value={formulario.classe} onChange={(e) => setFormulario({ ...formulario, classe: e.target.value as MovimentoNovo['classe'] })} className="mt-1 block w-full rounded-xl border border-borda bg-fundo px-3 py-3">
              <option value="acao">Ação</option><option value="etf">ETF</option><option value="fii">FII</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Quantidade<input required type="number" min="0.00000001" step="any" value={formulario.shares || ''} onChange={(e) => setFormulario({ ...formulario, shares: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border border-borda bg-fundo px-3 py-3" /></label>
            <label className="block text-sm">Preço unitário<input required type="number" min="0.01" step="any" value={formulario.preco || ''} onChange={(e) => setFormulario({ ...formulario, preco: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border border-borda bg-fundo px-3 py-3" /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Taxas<input type="number" min="0" step="any" value={formulario.taxas} onChange={(e) => setFormulario({ ...formulario, taxas: Number(e.target.value) })} className="mt-1 block w-full rounded-xl border border-borda bg-fundo px-3 py-3" /></label>
            <label className="block text-sm">Data<input required type="date" value={formulario.data} onChange={(e) => setFormulario({ ...formulario, data: e.target.value })} className="mt-1 block w-full rounded-xl border border-borda bg-fundo px-3 py-3" /></label>
          </div>
          {erroFormulario && <Alerta>{erroFormulario}</Alerta>}
          <Botao type="submit" carregando={salvando}>Salvar movimentação</Botao>
        </form>}
      </Modal>
    </>
  )
}
