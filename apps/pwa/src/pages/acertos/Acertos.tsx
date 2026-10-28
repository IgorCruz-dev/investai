import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import Alerta from '../../components/Alerta'
import Botao from '../../components/Botao'
import Card from '../../components/Card'
import { EsqueletoLista } from '../../components/Esqueleto'
import ListaLancamentos from '../../components/ListaLancamentos'
import ModalComprasDoCartao from '../../components/ModalComprasDoCartao'
import ModalPagamentoDoAcerto from '../../components/ModalPagamentoDoAcerto'
import { IconeCheck, IconeChevronEsquerda } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { acertoMesAMes, acertosPorPessoa, chaveDoMes, frasesDoSaldo } from '../../lib/acertos'
import { formatarMesAno, formatarMoeda } from '../../lib/formatar'
import { desmarcarMesPago, listarAcertosPagos, marcarMesPago } from '../../services/acertos'
import { listarCartoes } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import { listarLancamentosDeTerceiros } from '../../services/transacoes'
import type { AcertoPago, Cartao, Categoria, Transacao } from '../../types/financas'

/**
 * Acertos com outras pessoas: o que paguei por cada uma, o que ela me mandou e quem deve a quem.
 * Endereço: /acertos?pessoa=Mãe
 */
export default function Acertos() {
  const { versao, editarLancamento, novoLancamento, recarregar } = useLancamentos()
  const [adicionandoDoCartao, setAdicionandoDoCartao] = useState(false)
  const [pagando, setPagando] = useState(false)
  const [acertandoMes, setAcertandoMes] = useState(false)
  const [parametros, setParametros] = useSearchParams()
  const pessoa = parametros.get('pessoa')

  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [pagos, setPagos] = useState<AcertoPago[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([listarLancamentosDeTerceiros(), listarCategorias(), listarCartoes(), listarAcertosPagos()])
      .then(([ts, cats, crts, pgs]) => {
        if (!ativo) return
        setTransacoes(ts)
        setCategorias(cats)
        setCartoes(crts)
        setPagos(pgs)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar os acertos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [versao])

  const acertos = useMemo(() => acertosPorPessoa(transacoes, cartoes, pagos), [transacoes, cartoes, pagos])
  const escolhida = acertos.find((a) => a.pessoa === pessoa) ?? (acertos.length === 1 ? acertos[0] : null)
  const meses = useMemo(
    () => (escolhida ? acertoMesAMes(transacoes, escolhida.pessoa, cartoes, pagos) : []),
    [transacoes, escolhida, cartoes, pagos],
  )
  // Mês escolhido na lista; sem escolha, o último que já chegou (a fatura atual)
  const [chaveEscolhida, setChaveEscolhida] = useState<string | null>(null)
  const mesAtual = meses.find((m) => m.chave === chaveEscolhida) ?? meses.findLast((m) => !m.aVencer) ?? meses[0]
  const doMes = useMemo(
    () =>
      escolhida && mesAtual
        ? transacoes.filter((t) => t.terceiro === escolhida.pessoa && chaveDoMes(t) === mesAtual.chave)
        : [],
    [transacoes, escolhida, mesAtual],
  )

  /** Marca o mês como acertado por fora (ou volta a cobrar), sem criar lançamento */
  async function alternarMesPago() {
    if (!escolhida || !mesAtual) return
    setErro('')
    setAcertandoMes(true)
    try {
      if (mesAtual.pago) await desmarcarMesPago(escolhida.pessoa, mesAtual.mes)
      else await marcarMesPago(escolhida.pessoa, mesAtual.mes)
      setChaveEscolhida(mesAtual.chave)
      recarregar()
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setAcertandoMes(false)
    }
  }

  function escolher(nome: string) {
    setChaveEscolhida(null)
    setParametros(nome === escolhida?.pessoa ? {} : { pessoa: nome }, { replace: true })
  }

  return (
    <>
      <Link
        to="/dashboard"
        className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-texto-suave transition hover:text-texto"
      >
        <IconeChevronEsquerda className="h-4 w-4" />
        Início
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">Acertos</h1>
      <p className="mt-1 text-sm text-texto-suave">
        Lançamentos marcados como de outra pessoa. Eles ficam fora das suas receitas e despesas; aqui você vê o que pagou
        por cada uma e o que ela já te mandou.
      </p>

      <div className="mt-4 grid gap-3 sm:max-w-md sm:grid-cols-2">
        <Botao onClick={() => setAdicionandoDoCartao(true)} disabled={cartoes.length === 0}>
          Adicionar do cartão
        </Botao>
        <Botao variante="secundaria" onClick={() => novoLancamento({ terceiro: escolhida?.pessoa ?? '' })}>
          Lançar à mão
        </Botao>
      </div>

      {adicionandoDoCartao && (
        <ModalComprasDoCartao
          cartoes={cartoes}
          pessoas={acertos.map((a) => a.pessoa)}
          pessoaInicial={escolhida?.pessoa ?? acertos[0]?.pessoa ?? ''}
          aoFechar={() => setAdicionandoDoCartao(false)}
          aoSalvar={recarregar}
        />
      )}

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      {carregando && transacoes.length === 0 ? (
        <Card className="mt-6" semEspaco>
          <EsqueletoLista linhas={3} />
        </Card>
      ) : acertos.length === 0 ? (
        <Card className="mt-6">
          <p className="py-8 text-center text-sm text-texto-suave">
            Nenhum lançamento de outra pessoa ainda. Use &quot;Adicionar do cartão&quot; ou &quot;Lançar à mão&quot;, ou marque
            &quot;É de outra pessoa&quot; ao editar um lançamento.
          </p>
        </Card>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {acertos.map((a) => {
            const frase = frasesDoSaldo(a)
            const ativa = escolhida?.pessoa === a.pessoa
            return (
              <button
                key={a.pessoa}
                onClick={() => escolher(a.pessoa)}
                aria-pressed={ativa}
                className={`rounded-2xl border vidro p-5 text-left transition ${ativa ? 'border-primaria ring-4 ring-primaria/10' : 'border-borda hover:border-texto/20'}`}
              >
                <p className="text-sm text-texto-suave">{frase.titulo}</p>
                <p className={`mt-1 text-2xl font-bold tracking-tight ${frase.cor}`}>
                  {formatarMoeda(Math.abs(a.saldoCentavos) / 100)}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-texto-suave">
                  <div>
                    <dt>Paguei por {a.pessoa}</dt>
                    <dd className="text-sm font-semibold text-texto">{formatarMoeda(a.pagueiCentavos / 100)}</dd>
                  </div>
                  <div>
                    <dt>{a.pessoa} me mandou</dt>
                    <dd className="text-sm font-semibold text-texto">{formatarMoeda(a.recebiCentavos / 100)}</dd>
                  </div>
                  {a.aVencerCentavos > 0 && (
                    <div className="col-span-2">
                      <dt>A vencer (parcelas das próximas faturas)</dt>
                      <dd className="text-sm font-semibold text-texto">{formatarMoeda(a.aVencerCentavos / 100)}</dd>
                    </div>
                  )}
                </dl>
              </button>
            )
          })}
        </div>
      )}

      {escolhida && mesAtual && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card titulo="Mês a mês" className="lg:col-span-2" semEspaco>
            <p className="border-b border-borda px-5 py-3 text-xs text-texto-suave">
              Compra no cartão conta no mês em que a fatura vence.
            </p>
            <ul className="divide-y divide-borda">
              {meses.map((m) => {
                const ativo = m.chave === mesAtual.chave
                return (
                  <li key={m.chave}>
                    <button
                      onClick={() => setChaveEscolhida(m.chave)}
                      aria-pressed={ativo}
                      className={`block w-full px-5 py-3.5 text-left transition ${ativo ? 'bg-primaria/5' : 'hover:bg-texto/[0.05]'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`font-medium ${ativo ? 'text-primaria' : ''}`}>{formatarMesAno(m.mes)}</span>
                        <span className="shrink-0 font-semibold">{formatarMoeda(m.deveCentavos / 100)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-texto-suave">
                        <span>Pagou {formatarMoeda(m.pagouCentavos / 100)}</span>
                        {m.pago ? (
                          <span className="font-semibold text-receita">Acertado</span>
                        ) : m.aVencer ? (
                          <span className="rounded-full bg-texto/[0.07] px-2 py-0.5 font-medium">A vencer</span>
                        ) : m.faltaCentavos > 0 ? (
                          <span className="font-semibold text-despesa">Falta {formatarMoeda(m.faltaCentavos / 100)}</span>
                        ) : (
                          <span className="font-semibold text-receita">Pago</span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card
            titulo={`${escolhida.pessoa} em ${formatarMesAno(mesAtual.mes).toLowerCase()}`}
            className="lg:col-span-3"
            semEspaco
          >
            <dl className="grid grid-cols-3 gap-3 border-b border-borda px-5 py-4 text-sm">
              <div>
                <dt className="text-texto-suave">Deve</dt>
                <dd className="mt-0.5 text-lg font-bold">{formatarMoeda(mesAtual.deveCentavos / 100)}</dd>
              </div>
              <div>
                <dt className="text-texto-suave">Pagou</dt>
                <dd className="mt-0.5 text-lg font-bold text-receita">{formatarMoeda(mesAtual.pagouCentavos / 100)}</dd>
              </div>
              <div>
                <dt className="text-texto-suave">Falta</dt>
                <dd className="mt-0.5 text-lg font-bold text-despesa">{formatarMoeda(mesAtual.faltaCentavos / 100)}</dd>
              </div>
            </dl>
            <div className="grid gap-3 border-b border-borda px-5 py-4 sm:grid-cols-2">
              {mesAtual.pago ? (
                <>
                  <p className="flex h-12 items-center justify-center gap-2 rounded-xl bg-receita/15 font-semibold text-receita">
                    <IconeCheck className="h-5 w-5" />
                    Acertado por fora
                  </p>
                  <Botao variante="secundaria" onClick={alternarMesPago} carregando={acertandoMes}>
                    Voltar a cobrar
                  </Botao>
                </>
              ) : mesAtual.faltaCentavos > 0 ? (
                <>
                  <Botao onClick={() => setPagando(true)}>
                    {escolhida.pessoa} pagou · {formatarMoeda(mesAtual.faltaCentavos / 100)}
                  </Botao>
                  <Botao variante="secundaria" onClick={alternarMesPago} carregando={acertandoMes}>
                    Acertar sem lançar dinheiro
                  </Botao>
                </>
              ) : (
                <p className="flex h-12 items-center justify-center gap-2 rounded-xl bg-receita/15 font-semibold text-receita sm:col-span-2">
                  <IconeCheck className="h-5 w-5" />
                  {mesAtual.deveCentavos > 0 ? 'Mês pago' : 'Nada a acertar neste mês'}
                </p>
              )}
            </div>

            <ListaLancamentos transacoes={doMes} categorias={categorias} cartoes={cartoes} aoEscolher={editarLancamento} />
          </Card>
        </div>
      )}

      {pagando && escolhida && mesAtual && (
        <ModalPagamentoDoAcerto
          pessoa={escolhida.pessoa}
          mes={mesAtual.mes}
          faltaCentavos={mesAtual.faltaCentavos}
          aoFechar={() => setPagando(false)}
          aoSalvar={() => {
            setChaveEscolhida(mesAtual.chave)
            recarregar()
          }}
        />
      )}
    </>
  )
}
