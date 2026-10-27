import type { ConexaoPluggy } from '../types/financas'

/** Avisa quando faltar isso (ou menos) para o consentimento de 12 meses vencer */
export const DIAS_AVISO_CONSENTIMENTO = 30

const DIA = 24 * 60 * 60 * 1000

export type ProblemaConexao = {
  /** Texto curto para o selo ("Desconectado", "Vence em 12 dias") */
  selo: string
  /** Frase para o usuário, dizendo o que fazer */
  texto: string
  /** true: a importação parou; false: ainda funciona, mas precisa de atenção */
  grave: boolean
}

/** O que está errado com a conexão, ou null se está tudo certo */
export function problemaDaConexao(c: ConexaoPluggy, agora = new Date()): ProblemaConexao | null {
  if (c.status === 'NAO_ENCONTRADO') {
    return {
      selo: 'Não encontrada',
      texto:
        'A Pluggy não achou esta conexão. Se você reconectou o banco no meu.pluggy.ai, o id mudou: atualize o secret PLUGGY_ITEM_IDS no Supabase.',
      grave: true,
    }
  }

  const expira = c.consentimento_expira_em ? new Date(c.consentimento_expira_em) : null
  const venceu = (expira && expira <= agora) || c.erro === 'USER_AUTHORIZATION_EXPIRED' || c.erro === 'USER_AUTHORIZATION_REVOKED'
  if (venceu) {
    return {
      selo: 'Consentimento vencido',
      texto: `O consentimento do ${c.banco} acabou e a importação parou. Renove no meu.pluggy.ai.`,
      grave: true,
    }
  }

  if (c.status === 'LOGIN_ERROR' || c.status === 'OUTDATED' || c.status === 'WAITING_USER_INPUT') {
    return {
      selo: 'Desconectado',
      texto: `A conexão com o ${c.banco} caiu${c.erro ? ` (${c.erro})` : ''}. Reconecte no meu.pluggy.ai.`,
      grave: true,
    }
  }

  if (expira) {
    const dias = Math.ceil((expira.getTime() - agora.getTime()) / DIA)
    if (dias <= DIAS_AVISO_CONSENTIMENTO) {
      return {
        selo: dias === 1 ? 'Vence amanhã' : `Vence em ${dias} dias`,
        texto: `O consentimento do ${c.banco} vence em ${dias === 1 ? '1 dia' : `${dias} dias`}. Renove no meu.pluggy.ai para não parar a importação.`,
        grave: false,
      }
    }
  }
  return null
}
