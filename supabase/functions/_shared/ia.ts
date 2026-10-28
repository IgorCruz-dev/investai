// Única porta de saída para a API da Anthropic: confere o teto do mês antes e soma o gasto depois de cada chamada.
//
// Teto: secret IA_LIMITE_MENSAL_USD (padrão US$ 2). O workspace da chave também tem um spend limit no Console,
// que corta mesmo se esta conta falhar.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.3.0/helpers/zod'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { z } from 'npm:zod@4.6.7'

export const MODELO = 'claude-haiku-5-5'
// US$ por token, prompts de até 100 mil tokens (conferido em 27/10/2026: US$ 0,10 / 0,50 por milhão)
const PRECO_ENTRADA = 0.1 / 1_000_000
const PRECO_SAIDA = 0.5 / 1_000_000

export class LimiteAtingido extends Error {
  constructor(gasto: number, limite: number) {
    super(`limite do mês atingido (US$ ${gasto.toFixed(2)} de US$ ${limite.toFixed(2)})`)
  }
}

export const limiteMensal = () => Number(Deno.env.get('IA_LIMITE_MENSAL_USD') || 2)

const mesAtual = () => {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  return `${hoje.slice(0, 7)}-01`
}

export async function gastoDoMes(db: SupabaseClient) {
  const { data, error } = await db.from('ia_uso').select('custo_usd').eq('mes', mesAtual()).maybeSingle()
  if (error) throw error
  return Number(data?.custo_usd ?? 0)
}

/**
 * Chama o modelo pedindo JSON no formato do schema. Antes, estima o pior caso (entrada por caracteres, saída =
 * maxTokens) e recusa se o gasto do mês passaria do teto.
 */
export async function perguntar<T extends z.ZodType>(
  db: SupabaseClient,
  { sistema, pergunta, schema, maxTokens }: { sistema: string; pergunta: string; schema: T; maxTokens: number },
): Promise<z.infer<T>> {
  const chave = Deno.env.get('ANTHROPIC_API_KEY')
  if (!chave) throw new Error('falta o secret ANTHROPIC_API_KEY')

  const limite = limiteMensal()
  const gasto = await gastoDoMes(db)
  // ~2,5 caracteres por token em português é uma estimativa folgada (para cima)
  const estimativa = ((sistema.length + pergunta.length) / 2.5) * PRECO_ENTRADA + maxTokens * PRECO_SAIDA
  if (gasto + estimativa > limite) throw new LimiteAtingido(gasto, limite)

  const client = new Anthropic({ apiKey: chave, maxRetries: 1 })
  const resposta = await client.messages.parse({
    model: MODELO,
    max_tokens: maxTokens,
    // Classificação e resumo não precisam de raciocínio longo; sem thinking, a saída fica previsível no custo
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: zodOutputFormat(schema) },
    system: sistema,
    messages: [{ role: 'user', content: pergunta }],
  })

  const custo = resposta.usage.input_tokens * PRECO_ENTRADA + resposta.usage.output_tokens * PRECO_SAIDA
  const { error } = await db.rpc('registrar_uso_ia', {
    p_entrada: resposta.usage.input_tokens,
    p_saida: resposta.usage.output_tokens,
    p_custo: custo,
    p_limite: limite,
  })
  if (error) console.error('registrar_uso_ia', error)

  if (resposta.stop_reason === 'refusal') throw new Error('o modelo recusou a pergunta')
  if (resposta.stop_reason === 'max_tokens') throw new Error('a resposta passou do max_tokens')
  if (!resposta.parsed_output) throw new Error('a resposta não veio no formato pedido')
  return resposta.parsed_output
}
