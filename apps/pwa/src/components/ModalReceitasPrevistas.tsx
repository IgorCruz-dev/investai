import { useState } from 'react'
import { formatarMoeda } from '../lib/formatar'
import { excluirReceitaPrevista, salvarReceitaPrevista } from '../services/receitasPrevistas'
import type { ReceitaPrevista } from '../types/financas'
import Alerta from './Alerta'
import Botao from './Botao'
import Campo from './Campo'
import Modal from './Modal'

type Props = {
  previstas: ReceitaPrevista[]
  /** Ids das que já chegaram no mês que está aberto no dashboard */
  recebidas: Set<string>
  aoFechar: () => void
  aoSalvar: () => void
}

/** Lista e edita o que costuma entrar todo mês; tocar numa receita carrega ela no formulário */
export default function ModalReceitasPrevistas({ previstas, recebidas, aoFechar, aoSalvar }: Props) {
  const [editando, setEditando] = useState<ReceitaPrevista | null>(null)
  const [nome, setNome] = useState('')
  const [centavos, setCentavos] = useState(0)
  const [dia, setDia] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  function editar(p: ReceitaPrevista | null) {
    setEditando(p)
    setNome(p?.nome ?? '')
    setCentavos(p ? Math.round(p.valor * 100) : 0)
    setDia(p ? String(p.dia) : '')
    setErro('')
  }

  const diaNumero = Number(dia)
  const valido = nome.trim() !== '' && centavos > 0 && Number.isInteger(diaNumero) && diaNumero >= 1 && diaNumero <= 31

  async function executar(acao: () => Promise<unknown>) {
    setErro('')
    setSalvando(true)
    try {
      await acao()
      aoSalvar()
      editar(null)
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Receitas previstas"
      rodape={
        <div className="flex flex-col gap-2">
          <Botao
            onClick={() =>
              executar(() => salvarReceitaPrevista({ nome: nome.trim(), valor: centavos / 100, dia: diaNumero }, editando?.id))
            }
            carregando={salvando}
            disabled={!valido}
          >
            {editando ? 'Salvar alterações' : 'Adicionar'}
          </Botao>
          {editando && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => editar(null)}
                disabled={salvando}
                className="h-10 rounded-xl text-sm font-medium text-texto-suave transition hover:bg-texto/[0.05] hover:text-texto"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => executar(() => excluirReceitaPrevista(editando.id))}
                disabled={salvando}
                className="h-10 rounded-xl text-sm font-semibold text-despesa transition hover:bg-despesa/12"
              >
                Excluir
              </button>
            </div>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-texto-suave">
          Contam no resultado do mês até chegarem. Quando cai uma receita de pelo menos 90% do valor, a partir de 5 dias antes do
          dia, a prevista sai da conta.
        </p>

        {previstas.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {previstas.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => editar(p)}
                  className={`flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left transition ${editando?.id === p.id ? 'bg-destaque/15' : 'bg-texto/[0.04] hover:bg-texto/[0.08]'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.nome}</span>
                    <span className="text-xs text-texto-suave">
                      Todo dia {p.dia} · {recebidas.has(p.id) ? 'já chegou neste mês' : 'ainda não chegou'}
                    </span>
                  </span>
                  <span className={`numero shrink-0 font-semibold ${recebidas.has(p.id) ? 'text-texto-suave' : 'text-receita'}`}>
                    +{formatarMoeda(p.valor)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Campo id="prevista-nome" label="Nome" placeholder="Salário" value={nome} onChange={(e) => setNome(e.target.value)} />
          <Campo
            id="prevista-dia"
            label="Dia"
            inputMode="numeric"
            placeholder="5"
            value={dia}
            onChange={(e) => setDia(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
        </div>
        <Campo
          id="prevista-valor"
          label="Valor"
          inputMode="numeric"
          autoComplete="off"
          value={formatarMoeda(centavos / 100)}
          onChange={(e) => setCentavos(Number(e.target.value.replace(/\D/g, '').slice(-11) || 0))}
        />
        {erro && <Alerta>{erro}</Alerta>}
      </div>
    </Modal>
  )
}
