import { useEffect, useMemo, useState } from 'react'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import Esqueleto, { EsqueletoLista } from '../../components/Esqueleto'
import GraficoComparativoCategorias, { type BarraCategoria } from '../../components/GraficoComparativoCategorias'
import IconeCategoria from '../../components/IconeCategoria'
import SeletorMes from '../../components/SeletorMes'
import { IconeGrafico, IconeSetaBaixo, IconeSetaCima } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { compararCategorias, totaisDoMes, variacao, type LinhaCategoria } from '../../lib/comparativo'
import { diasNoMes, inicioDoMes, mesAnterior, paraMesISO } from '../../lib/datas'
import { formatarMesAno, formatarMoeda, formatarNomeDoMes } from '../../lib/formatar'
import { listarCategorias } from '../../services/categorias'
import { listarTransacoesDoMes } from '../../services/transacoes'
import type { Categoria, Transacao } from '../../types/financas'

/** Categorias no gráfico; o resto vira "Outras" (a tabela mostra todas) */
const CATEGORIAS_NO_GRAFICO = 7

/** "setembro", ou "setembro de 2025" quando os dois meses são de anos diferentes */
function nomeDoMes(mes: Date, outro: Date) {
  return mes.getFullYear() === outro.getFullYear() ? formatarNomeDoMes(mes) : formatarMesAno(mes).toLowerCase()
}

/** Diferença em R$ com sinal: "+R$ 320,00" / "−R$ 45,90" */
function diferencaEmReais(valor: number) {
  if (valor === 0) return formatarMoeda(0)
  return `${valor > 0 ? '+' : '−'}${formatarMoeda(Math.abs(valor))}`
}

export default function Comparativo() {
  const { versao } = useLancamentos()
  const [mesA, setMesA] = useState(() => inicioDoMes())
  const [mesB, setMesB] = useState(() => mesAnterior(inicioDoMes()))

  const [transacoesA, setTransacoesA] = useState<Transacao[]>([])
  const [transacoesB, setTransacoesB] = useState<Transacao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([listarTransacoesDoMes(mesA), listarTransacoesDoMes(mesB), listarCategorias()])
      .then(([a, b, cats]) => {
        if (!ativo) return
        setTransacoesA(a)
        setTransacoesB(b)
        setCategorias(cats)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar os dados para comparar.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [mesA, mesB, versao])

  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])
  const totaisA = useMemo(() => totaisDoMes(transacoesA, categoriaPorId), [transacoesA, categoriaPorId])
  const totaisB = useMemo(() => totaisDoMes(transacoesB, categoriaPorId), [transacoesB, categoriaPorId])
  const linhas = useMemo(() => compararCategorias(transacoesA, transacoesB), [transacoesA, transacoesB])

  const nomeA = nomeDoMes(mesA, mesB)
  const nomeB = nomeDoMes(mesB, mesA)
  const nomeDaCategoria = (chave: string) => (chave === 'sem' ? 'Sem categoria' : (categoriaPorId.get(chave)?.nome ?? 'Categoria'))
  const mesmoMes = paraMesISO(mesA) === paraMesISO(mesB)

  // Gráfico: maiores categorias (pelo maior dos dois meses) e o resto somado em "Outras"
  const barras = useMemo<BarraCategoria[]>(() => {
    const ordenadas = [...linhas].sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b))
    const principais = ordenadas.slice(0, CATEGORIAS_NO_GRAFICO).map((l) => ({ nome: nomeDaCategoria(l.chave), a: l.a, b: l.b }))
    const resto = ordenadas.slice(CATEGORIAS_NO_GRAFICO)
    if (resto.length > 0) {
      principais.push({
        nome: 'Outras',
        a: resto.reduce((s, l) => s + Math.round(l.a * 100), 0) / 100,
        b: resto.reduce((s, l) => s + Math.round(l.b * 100), 0) / 100,
      })
    }
    return principais
  }, [linhas, categoriaPorId]) // nomeDaCategoria depende só de categoriaPorId

  const resumo = useMemo(() => {
    if (totaisA.despesas === 0 && totaisB.despesas === 0) return `Nenhum gasto em ${nomeA} nem em ${nomeB}.`
    let texto: string
    if (totaisB.despesas === 0) {
      texto = `Sem gastos em ${nomeB} para comparar. Em ${nomeA} você gastou ${formatarMoeda(totaisA.despesas)}.`
    } else {
      const v = variacao(totaisA.despesas, totaisB.despesas) ?? 0
      texto =
        v > 0
          ? `Você gastou ${v}% a mais que em ${nomeB}.`
          : v < 0
            ? `Você gastou ${Math.abs(v)}% a menos que em ${nomeB}.`
            : `Você gastou o mesmo que em ${nomeB}.`
    }
    const maior = linhas[0]
    if (maior && maior.diferenca > 0) {
      texto += ` Maior aumento: ${nomeDaCategoria(maior.chave)} (${diferencaEmReais(maior.diferenca)}).`
    } else if (totaisB.despesas > 0) {
      texto += ' Nenhuma categoria aumentou.'
    }
    return texto
  }, [totaisA, totaisB, linhas, nomeA, nomeB, categoriaPorId])

  // Aviso quando o mês A ainda não terminou (a comparação com um mês fechado fica desigual)
  const hoje = new Date()
  const mesAEmAndamento = paraMesISO(mesA) === paraMesISO(hoje)
  // As categorias padrão sempre existem: lista vazia = primeira carga ainda não chegou
  const primeiraCarga = carregando && categorias.length === 0
  const recarregando = carregando ? 'opacity-60 transition' : 'transition'

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Comparativo</h1>

      {/* Escolha dos meses */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Mês</span>
          <SeletorMes mes={mesA} aoMudar={setMesA} />
        </div>
        <span className="hidden pb-3 text-sm text-texto-suave sm:block">comparado com</span>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium sm:sr-only">Comparado com</span>
          <SeletorMes mes={mesB} aoMudar={setMesB} />
        </div>
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      {primeiraCarga && !mesmoMes ? (
        <div aria-busy="true" aria-label="Carregando">
          <Esqueleto className="mt-5 h-16 rounded-2xl" />
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2 rounded-2xl border border-borda bg-white p-4">
                <Esqueleto className="h-4 w-1/2" />
                <Esqueleto className="h-6 w-3/4" />
                <Esqueleto className="h-3 w-2/3" />
              </div>
            ))}
          </div>
          <Card titulo="Gastos por categoria" className="mt-6">
            <Esqueleto className="h-64" />
          </Card>
          <Card titulo="Por categoria" className="mt-6" semEspaco>
            <EsqueletoLista linhas={4} />
          </Card>
        </div>
      ) : mesmoMes ? (
        <p className="mt-6 rounded-2xl border border-borda bg-white px-5 py-8 text-center text-texto-suave">
          Escolha dois meses diferentes para comparar.
        </p>
      ) : (
        <>
          {/* Resumo em texto */}
          <div className={`mt-5 rounded-2xl bg-emerald-50 px-5 py-4 ${recarregando}`} aria-live="polite">
            <p className="font-medium text-emerald-950">{resumo}</p>
            {mesAEmAndamento && (
              <p className="mt-1 text-sm text-emerald-900/70">
                {formatarNomeDoMes(mesA).charAt(0).toUpperCase() + formatarNomeDoMes(mesA).slice(1)} ainda está em andamento
                (dia {hoje.getDate()} de {diasNoMes(mesA)}).
              </p>
            )}
          </div>

          {/* Cards */}
          <div className={`mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 ${recarregando}`}>
            <CartaoComparacao titulo="Receitas" a={totaisA.receitas} b={totaisB.receitas} subirEhBom nomeB={nomeB} />
            <CartaoComparacao titulo="Despesas" a={totaisA.despesas} b={totaisB.despesas} subirEhBom={false} nomeB={nomeB} />
            <CartaoComparacao titulo="Resultado do mês" a={totaisA.resultado} b={totaisB.resultado} subirEhBom nomeB={nomeB} />
            <CartaoComparacao titulo="Assinaturas" a={totaisA.assinaturas} b={totaisB.assinaturas} subirEhBom={false} nomeB={nomeB} />
          </div>

          {linhas.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-2xl border border-borda bg-white px-5 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-texto-suave">
                <IconeGrafico className="h-6 w-6" />
              </span>
              <p className="mt-4 font-medium">Nada para comparar ainda</p>
              <p className="mt-1 max-w-xs text-sm text-texto-suave">Lance seus gastos para ver a comparação por categoria.</p>
            </div>
          ) : (
            <>
              {/* Gráfico */}
              <Card titulo="Gastos por categoria" className={`mt-6 ${recarregando}`}>
                <GraficoComparativoCategorias barras={barras} nomeA={nomeA} nomeB={nomeB} />
              </Card>

              {/* Tabela */}
              <Card titulo="Por categoria" className={`mt-6 ${recarregando}`} semEspaco>
                <TabelaCategorias
                  linhas={linhas}
                  categoriaPorId={categoriaPorId}
                  nomeDaCategoria={nomeDaCategoria}
                  nomeA={nomeA}
                  nomeB={nomeB}
                />
              </Card>
            </>
          )}
        </>
      )}
    </>
  )
}

type CartaoComparacaoProps = {
  titulo: string
  a: number
  b: number
  /** Receita e resultado: subir é bom (verde). Despesas e assinaturas: subir é ruim (vermelho). */
  subirEhBom: boolean
  nomeB: string
}

function CartaoComparacao({ titulo, a, b, subirEhBom, nomeB }: CartaoComparacaoProps) {
  const diferenca = Math.round((a - b) * 100) / 100
  const percentual = variacao(a, b)
  const bom = (diferenca > 0) === subirEhBom
  const cor = diferenca === 0 ? 'text-texto-suave' : bom ? 'text-receita' : 'text-despesa'

  return (
    <div className="rounded-2xl border border-borda bg-white p-4">
      <p className="text-sm text-texto-suave">{titulo}</p>
      <p className={`mt-1 text-xl font-bold tracking-tight ${a < 0 ? 'text-despesa' : ''}`}>{formatarMoeda(a)}</p>
      <p className={`mt-2 flex items-center gap-1 text-sm font-semibold ${cor}`}>
        {diferenca > 0 && <IconeSetaCima className="h-4 w-4 shrink-0" />}
        {diferenca < 0 && <IconeSetaBaixo className="h-4 w-4 shrink-0" />}
        <span>
          {diferenca === 0 ? 'Sem mudança' : diferencaEmReais(diferenca)}
          {diferenca !== 0 && percentual !== null && ` (${percentual > 0 ? '+' : '−'}${Math.abs(percentual)}%)`}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-texto-suave">
        {formatarMoeda(b)} em {nomeB}
      </p>
    </div>
  )
}

type TabelaProps = {
  linhas: LinhaCategoria[]
  categoriaPorId: Map<string, Categoria>
  nomeDaCategoria: (chave: string) => string
  nomeA: string
  nomeB: string
}

/** Aumento de gasto em vermelho, queda em verde */
function corDaDiferenca(diferenca: number) {
  if (diferenca > 0) return 'text-despesa'
  if (diferenca < 0) return 'text-receita'
  return 'text-texto-suave'
}

function textoVariacao(linha: LinhaCategoria) {
  if (linha.variacao === null) return linha.a > 0 ? 'novo' : '—'
  return `${linha.variacao > 0 ? '+' : linha.variacao < 0 ? '−' : ''}${Math.abs(linha.variacao)}%`
}

/** Celular: uma linha por categoria; telas maiores: tabela com colunas */
function TabelaCategorias({ linhas, categoriaPorId, nomeDaCategoria, nomeA, nomeB }: TabelaProps) {
  return (
    <>
      <ul className="divide-y divide-borda sm:hidden">
        {linhas.map((l) => {
          const categoria = categoriaPorId.get(l.chave)
          return (
            <li key={l.chave} className="flex items-center gap-3 px-5 py-3.5">
              <IconeCategoria icone={categoria?.icone} cor={categoria?.cor} tamanho="pequeno" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{nomeDaCategoria(l.chave)}</span>
                  <span className={`shrink-0 text-sm font-semibold ${corDaDiferenca(l.diferenca)}`}>
                    {diferencaEmReais(l.diferenca)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-texto-suave">
                  <span className="truncate">
                    {formatarMoeda(l.a)} <span className="capitalize">{nomeA.split(' ')[0].slice(0, 3)}</span> · {formatarMoeda(l.b)}{' '}
                    <span className="capitalize">{nomeB.split(' ')[0].slice(0, 3)}</span>
                  </span>
                  <span className={`shrink-0 font-semibold ${corDaDiferenca(l.diferenca)}`}>{textoVariacao(l)}</span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <table className="hidden w-full text-sm tabular-nums sm:table">
        <thead className="bg-slate-50 text-left text-xs text-texto-suave">
          <tr>
            <th className="px-5 py-2.5 font-medium">Categoria</th>
            <th className="px-3 py-2.5 text-right font-medium capitalize">{nomeA}</th>
            <th className="px-3 py-2.5 text-right font-medium capitalize">{nomeB}</th>
            <th className="px-3 py-2.5 text-right font-medium">Diferença</th>
            <th className="px-5 py-2.5 text-right font-medium">Variação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {linhas.map((l) => {
            const categoria = categoriaPorId.get(l.chave)
            return (
              <tr key={l.chave}>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-2.5">
                    <IconeCategoria icone={categoria?.icone} cor={categoria?.cor} tamanho="pequeno" />
                    <span className="font-medium">{nomeDaCategoria(l.chave)}</span>
                  </span>
                </td>
                <td className="px-3 py-3 text-right">{formatarMoeda(l.a)}</td>
                <td className="px-3 py-3 text-right text-texto-suave">{formatarMoeda(l.b)}</td>
                <td className={`px-3 py-3 text-right font-semibold ${corDaDiferenca(l.diferenca)}`}>{diferencaEmReais(l.diferenca)}</td>
                <td className={`px-5 py-3 text-right font-semibold ${corDaDiferenca(l.diferenca)}`}>{textoVariacao(l)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
