import type { StatusSessao } from '@es/contrato/agenda';

// AGE-07, AGE-08, AGE-09, AGE-10: regras puras das transições de status da sessão, copiadas de
// backend/src/scheduling/domain/session.ts do legado (STATUS_TRANSITIONS e canTransition), com
// realizada -> cancelada acrescentada e guardada pelos registros da sessão (AGE-08), e com o
// cobravel da falta e do cancelamento em falso por padrão (AGE-10; no legado, mantinha o atual).

export const TRANSICOES: Record<StatusSessao, readonly StatusSessao[]> = {
  agendada: ['realizada', 'faltou', 'cancelada', 'remarcada'],
  realizada: ['agendada', 'faltou', 'cancelada'],
  faltou: ['agendada', 'realizada'],
  cancelada: ['agendada'],
  remarcada: ['agendada'],
};

export type ResultadoTransicao =
  'mesmo_status' | 'permitida' | 'transicao_invalida' | 'SESSION_HAS_RECORDS';

// `temRegistros`: a sessão tem evolução ou pagamento (a API consulta com sessaoTemRegistros).
export function avaliarTransicao(
  de: StatusSessao,
  para: StatusSessao,
  temRegistros: boolean,
): ResultadoTransicao {
  if (de === para) return 'mesmo_status';
  if (!TRANSICOES[de].includes(para)) return 'transicao_invalida';
  if (de === 'realizada' && para === 'cancelada' && temRegistros) return 'SESSION_HAS_RECORDS';
  return 'permitida';
}

export const transicaoPermitida = (
  de: StatusSessao,
  para: StatusSessao,
  temRegistros: boolean,
): boolean => {
  const resultado = avaliarTransicao(de, para, temRegistros);
  return resultado === 'mesmo_status' || resultado === 'permitida';
};

const SEM_COBRANCA_PADRAO: readonly StatusSessao[] = ['faltou', 'cancelada'];

// AGE-10: virar falta ou cancelamento grava cobravel = false, salvo "cobrar" (cobrar = true).
// No mesmo status, ou indo para os demais, só muda se "cobrar" vier.
export function cobravelApos(
  de: StatusSessao,
  para: StatusSessao,
  cobrar: boolean | undefined,
  atual: boolean,
): boolean {
  if (de !== para && SEM_COBRANCA_PADRAO.includes(para)) return cobrar === true;
  return cobrar ?? atual;
}

// AGE-09: cancelada ou remarcada voltando a agendada volta a ocupar o horário, então a API
// reaplica dia habilitado e conflito.
export const reabreHorario = (de: StatusSessao, para: StatusSessao): boolean =>
  para === 'agendada' && (de === 'cancelada' || de === 'remarcada');
