import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import { EsqueletoLista } from '../../components/Esqueleto'
import Modal from '../../components/Modal'
import { IconeChevronEsquerda, IconeFechar } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { listarCategorias } from '../../services/categorias'
import {
  categoriasDoBanco,
  excluirRegraDeLocal,
  listarMapeamentos,
  listarRegrasDeLocal,
  mapearCategoria,
} from '../../services/openFinance'
import type { Categoria, RegraLocal } from '../../types/financas'
import { COR_SEM_CATEGORIA } from '../../components/IconeCategoria'

const PADRAO = ''

// A Pluggy manda as categorias em inglês; as mais comuns ganham nome em português
const traducoes: Record<string, string> = {
  Income: 'Renda',
  Salary: 'Salário',
  Retirement: 'Aposentadoria',
  Investments: 'Investimentos',
  'Same person transfer': 'Transferência entre contas próprias',
  Transfers: 'Transferências',
  'Transfer - PIX': 'Transferência Pix',
  'Transfer - TED': 'Transferência TED',
  'Credit card payment': 'Pagamento de fatura',
  Services: 'Serviços',
  Shopping: 'Compras',
  'Online shopping': 'Compras online',
  Electronics: 'Eletrônicos',
  Clothing: 'Roupas',
  'Digital services': 'Serviços digitais',
  'Video streaming': 'Streaming de vídeo',
  'Music streaming': 'Streaming de música',
  Groceries: 'Mercado',
  'Food and drinks': 'Comida e bebida',
  'Eating out': 'Restaurantes',
  'Food delivery': 'Delivery',
  Travel: 'Viagem',
  Taxes: 'Impostos',
  'Bank fees': 'Tarifas bancárias',
  Housing: 'Moradia',
  Rent: 'Aluguel',
  Utilities: 'Contas da casa',
  Electricity: 'Luz',
  Water: 'Água',
  Internet: 'Internet',
  Healthcare: 'Saúde',
  Pharmacy: 'Farmácia',
  Transportation: 'Transporte',
  'Taxi and ride-hailing': 'Táxi e apps de corrida',
  'Gas stations': 'Combustível',
  Parking: 'Estacionamento',
  Insurance: 'Seguros',
  Leisure: 'Lazer',
  Education: 'Educação',
  Donations: 'Doações',
}

const traduzir = (categoria: string) => traducoes[categoria] ?? categoria

/** Para qual categoria do app vai cada categoria da Pluggy, e as regras por local */
export default function CategoriasDoBanco() {
  const { versao } = useLancamentos()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [doBanco, setDoBanco] = useState<Map<string, number>>(new Map())
  const [mapeadas, setMapeadas] = useState<Map<string, string>>(new Map())
  const [regras, setRegras] = useState<RegraLocal[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [salvando, setSalvando] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState<RegraLocal | null>(null)

  async function carregar() {
    const [cats, banco, maps, rgs] = await Promise.all([listarCategorias(), categoriasDoBanco(), listarMapeamentos(), listarRegrasDeLocal()])
    setCategorias(cats)
    setDoBanco(banco)
    setMapeadas(new Map(maps.map((m) => [m.categoria_pluggy, m.categoria_id])))
    setRegras(rgs)
  }

  useEffect(() => {
    let ativo = true
    carregar()
      .catch(() => ativo && setErro('Não foi possível carregar as categorias.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [versao])

  const outros = categorias.find((c) => c.nome === 'Outros')
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])

  // Todas as que já apareceram, mais as mapeadas que ainda não vieram neste período; as mais usadas primeiro
  const linhas = useMemo(() => {
    const nomes = new Set([...doBanco.keys(), ...mapeadas.keys()])
    nomes.delete('Credit card payment') // pagamento de fatura não usa categoria
    return [...nomes].sort((a, b) => (doBanco.get(b) ?? 0) - (doBanco.get(a) ?? 0) || traduzir(a).localeCompare(traduzir(b)))
  }, [doBanco, mapeadas])

  async function mudar(categoriaPluggy: string, categoriaId: string) {
    setErro('')
    setAviso('')
    setSalvando(categoriaPluggy)
    try {
      await mapearCategoria(categoriaPluggy, categoriaId || null, outros?.id ?? null)
      await carregar()
      if (categoriaId) setAviso(`As importadas de "${traduzir(categoriaPluggy)}" que estavam em Outros foram atualizadas.`)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(null)
    }
  }

  return (
    <>
      <Link to="/bancos" className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-texto-suave transition hover:text-texto">
        <IconeChevronEsquerda className="h-4 w-4" />
        Bancos
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Categorias do banco</h1>
      <p className="mt-1 text-sm text-texto-suave">
        Cada transação importada recebe a categoria da regra por local; se não houver, a deste mapeamento; se não houver,
        "Outros".
      </p>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}
      {aviso && (
        <p role="status" className="mt-4 rounded-xl bg-sucesso-fundo px-4 py-3 text-sm text-sucesso-texto">
          {aviso}
        </p>
      )}

      <Card titulo="Categorias da Pluggy" className="mt-6" semEspaco>
        {carregando ? (
          <EsqueletoLista linhas={5} />
        ) : linhas.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-texto-suave">
            Nenhuma categoria ainda. Elas aparecem aqui depois da primeira sincronização.
          </p>
        ) : (
          <ul className="divide-y divide-borda">
            {linhas.map((nome) => {
              const id = `map-${nome}`
              const qtd = doBanco.get(nome) ?? 0
              return (
                <li key={nome} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
                  <label htmlFor={id} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{traduzir(nome)}</span>
                    <span className="block truncate text-xs text-texto-suave">
                      {traducoes[nome] ? `${nome} · ` : ''}
                      {qtd} {qtd === 1 ? 'transação' : 'transações'}
                    </span>
                  </label>
                  <select
                    id={id}
                    value={mapeadas.get(nome) ?? PADRAO}
                    disabled={salvando === nome}
                    onChange={(e) => mudar(nome, e.target.value)}
                    className="h-10 rounded-xl border border-borda bg-superficie px-3 text-base outline-none sm:text-sm focus:border-primaria focus:ring-4 focus:ring-primaria/15 disabled:opacity-60 sm:w-56"
                  >
                    <option value={PADRAO}>Outros (padrão)</option>
                    {categorias
                      .filter((c) => c.id !== outros?.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                  </select>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card titulo="Regras por local" className="mt-6" semEspaco>
        {carregando ? (
          <EsqueletoLista linhas={2} />
        ) : regras.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-texto-suave">
            Ao trocar a categoria de uma transação importada, o app pergunta se vale para as próximas do mesmo local.
          </p>
        ) : (
          <ul className="divide-y divide-borda">
            {regras.map((r) => {
              const categoria = categoriaPorId.get(r.categoria_id)
              return (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.local}</span>
                    <span className="flex items-center gap-1.5 text-xs text-texto-suave">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: categoria?.cor ?? COR_SEM_CATEGORIA }} />
                      {categoria?.nome ?? 'Categoria'}
                    </span>
                  </span>
                  <button
                    onClick={() => setExcluindo(r)}
                    aria-label={`Excluir regra de ${r.local}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-texto-suave transition hover:bg-erro-fundo hover:text-despesa"
                  >
                    <IconeFechar className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {excluindo && (
        <ModalExcluirRegra
          regra={excluindo}
          aoFechar={() => setExcluindo(null)}
          aoExcluir={() => {
            setExcluindo(null)
            carregar().catch(() => setErro('Não foi possível recarregar as regras.'))
          }}
        />
      )}
    </>
  )
}

function ModalExcluirRegra({ regra, aoFechar, aoExcluir }: { regra: RegraLocal; aoFechar: () => void; aoExcluir: () => void }) {
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    setErro('')
    setSalvando(true)
    try {
      await excluirRegraDeLocal(regra.id)
      aoExcluir()
    } catch (e) {
      setErro((e as Error).message)
      setSalvando(false)
    }
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Excluir regra">
      <div className="flex flex-col gap-4">
        <p className="text-texto-suave">
          As próximas transações de <strong className="text-texto">{regra.local}</strong> voltam a usar o mapeamento de
          categorias. As que já foram importadas não mudam.
        </p>
        {erro && <Alerta>{erro}</Alerta>}
        <Botao variante="perigo" carregando={salvando} onClick={confirmar}>
          Excluir regra
        </Botao>
        <button
          type="button"
          onClick={aoFechar}
          disabled={salvando}
          className="h-11 rounded-xl text-sm font-medium text-texto-suave transition hover:bg-superficie-2 hover:text-texto"
        >
          Cancelar
        </button>
      </div>
    </Modal>
  )
}
