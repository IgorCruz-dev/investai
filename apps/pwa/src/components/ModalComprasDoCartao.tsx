import { useEffect, useMemo, useState } from 'react'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import { EsqueletoLista } from './Esqueleto'
import Modal from './Modal'
import SeletorMes from './SeletorMes'
import { mesDaFatura } from '../lib/fatura'
import { formatarDiaMes, formatarMoeda } from '../lib/formatar'
import { listarComprasSemDono, marcarDeTerceiro } from '../services/transacoes'
import type { Cartao, Transacao } from '../types/financas'

type Props = {
  cartoes: Cartao[]
  /** Nomes já usados nos acertos, sugeridos enquanto digita */
  pessoas: string[]
  pessoaInicial: string
  aoFechar: () => void
  aoSalvar: () => void
}

/**
 * Escolhe compras de uma fatura do cartão e marca como de outra pessoa (ex.: as da mãe).
 * Compra parcelada leva todas as parcelas. Elas saem das minhas despesas e vão para os Acertos.
 */
export default function ModalComprasDoCartao({ cartoes, pessoas, pessoaInicial, aoFechar, aoSalvar }: Props) {
  const [pessoa, setPessoa] = useState(pessoaInicial)
  // Começa na fatura aberta hoje (a que recebe as compras de agora)
  const [fatura, setFatura] = useState(() =>
    cartoes.length ? mesDaFatura(new Date(), cartoes[0].dia_fechamento, cartoes[0].dia_vencimento) : new Date(),
  )
  const [cartaoId, setCartaoId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [compras, setCompras] = useState<Transacao[]>([])
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    listarComprasSemDono(fatura)
      .then((cs) => ativo && setCompras(cs))
      .catch(() => ativo && setErro('Não foi possível carregar as compras.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [fatura])

  const cartaoPorId = useMemo(() => new Map(cartoes.map((c) => [c.id, c])), [cartoes])
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return compras.filter(
      (t) =>
        (!cartaoId || t.cartao_id === cartaoId) &&
        (!termo || `${t.local ?? ''} ${t.descricao ?? ''}`.toLowerCase().includes(termo)),
    )
  }, [compras, cartaoId, busca])
  const totalEscolhido = compras.filter((t) => escolhidas.has(t.id)).reduce((s, t) => s + Math.round(t.valor * 100), 0)

  function alternar(id: string) {
    setEscolhidas((atuais) => {
      const novas = new Set(atuais)
      if (novas.has(id)) novas.delete(id)
      else novas.add(id)
      return novas
    })
  }

  async function confirmar() {
    if (!pessoa.trim() || escolhidas.size === 0) return
    setErro('')
    setSalvando(true)
    try {
      await marcarDeTerceiro(
        compras.filter((t) => escolhidas.has(t.id)),
        pessoa,
      )
      aoSalvar()
      aoFechar()
    } catch (e) {
      setErro((e as Error).message)
      setSalvando(false)
    }
  }

  const nome = pessoa.trim() || 'outra pessoa'

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Adicionar do cartão"
      rodape={
        <Botao onClick={confirmar} carregando={salvando} disabled={!pessoa.trim() || escolhidas.size === 0}>
          {escolhidas.size === 0
            ? 'Escolha as compras'
            : `Marcar ${escolhidas.size} como de ${nome} · ${formatarMoeda(totalEscolhido / 100)}`}
        </Botao>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Campo
            id="compras-pessoa"
            label="De quem são"
            placeholder="Ex.: Mãe"
            required
            maxLength={40}
            list="compras-pessoas"
            value={pessoa}
            onChange={(e) => setPessoa(e.target.value)}
          />
          <datalist id="compras-pessoas">
            {pessoas.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">Fatura que vence em</p>
          <SeletorMes
            mes={fatura}
            aoMudar={(nova) => {
              setFatura(nova)
              setEscolhidas(new Set())
            }}
          />
        </div>

        {cartoes.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {[{ id: null, nome: 'Todos' }, ...cartoes].map((c) => (
              <button
                key={c.id ?? 'todos'}
                type="button"
                onClick={() => setCartaoId(c.id)}
                aria-pressed={cartaoId === c.id}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition ${cartaoId === c.id ? 'border-primaria bg-primaria/10 font-semibold text-primaria' : 'border-borda text-texto hover:bg-texto/[0.05]'}`}
              >
                {c.nome}
              </button>
            ))}
          </div>
        )}

        <Campo
          id="compras-busca"
          label="Buscar"
          placeholder="Nome da loja"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        {erro && <Alerta>{erro}</Alerta>}

        <div className="-mx-1 rounded-xl border border-borda">
          {carregando ? (
            <EsqueletoLista linhas={4} />
          ) : visiveis.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-texto-suave">Nenhuma compra sem dono nesta fatura.</p>
          ) : (
            <ul className="divide-y divide-borda">
              {visiveis.map((t) => {
                const detalhes = [
                  formatarDiaMes(t.data),
                  cartaoPorId.get(t.cartao_id ?? '')?.nome,
                  t.total_parcelas ? `${t.parcela_atual}/${t.total_parcelas} · leva todas as parcelas` : null,
                ].filter(Boolean)
                return (
                  <li key={t.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-texto/[0.05]">
                      <input
                        type="checkbox"
                        checked={escolhidas.has(t.id)}
                        onChange={() => alternar(t.id)}
                        className="h-4 w-4 shrink-0 accent-primaria"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{t.local || t.descricao || 'Compra'}</span>
                        <span className="block truncate text-xs text-texto-suave">{detalhes.join(' · ')}</span>
                      </span>
                      <span className="shrink-0 font-semibold">{formatarMoeda(t.valor)}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
