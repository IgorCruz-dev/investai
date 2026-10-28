import { intervaloDoMes, inicioDoMes, somarMeses } from '../lib/datas'
import { separarDaEmpresa } from '../lib/empresa'
import { gastoEmCentavos } from '../lib/resumos'
import { listarCartoes } from './cartoes'
import { listarContas } from './contas'
import { buscarSaldoEm, listarTransacoesDoMes } from './transacoes'

/** Média dos últimos meses fechados, só dinheiro pessoal: quanto gasta e quanto sobra por mês */
export type PerfilFinanceiro = { meses: number; gastoMedio: number; sobraMedia: number }

const MESES = 3

export async function buscarPerfilFinanceiro(): Promise<PerfilFinanceiro> {
  const atual = inicioDoMes()
  const meses = Array.from({ length: MESES }, (_, i) => somarMeses(atual, -(i + 1)))
  // Sobra = variação do saldo no mês (mesma regra do "Resultado do mês" de meses fechados)
  const fins = [somarMeses(atual, -(MESES + 1)), ...meses.slice().reverse()].map((m) => intervaloDoMes(m)[1])

  const [contas, cartoes, transacoesPorMes, saldos] = await Promise.all([
    listarContas(),
    listarCartoes(),
    Promise.all(meses.map((m) => listarTransacoesDoMes(m))),
    Promise.all(fins.map((dia) => buscarSaldoEm(dia))),
  ])

  // Mês sem nenhum lançamento (antes do histórico começar) não entra na média
  const comDados = transacoesPorMes.filter((ts) => ts.length > 0)
  const gastos = comDados.map(
    (ts) => separarDaEmpresa(ts, contas, cartoes).pessoais.reduce((s, t) => s + gastoEmCentavos(t), 0) / 100,
  )
  const sobras = saldos
    .slice(1)
    .map((s, i) => s - saldos[i])
    .slice(-comDados.length)
  const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
  return { meses: comDados.length, gastoMedio: media(gastos), sobraMedia: media(sobras) }
}
