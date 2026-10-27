// PLANO-01, 02, 03, 04, 10, 11 (D-20, D-21): regras puras da assinatura e do limite do Free.
// Não há equivalente no legado (ele não tinha planos). O tempo vem sempre por parâmetro (`agora`);
// os intervalos são semiabertos: um instante igual a `agora` já não está "no futuro".

export const ESTADOS_ASSINATURA = ['trial', 'ativa', 'atrasada', 'cancelada', 'free'] as const;
export type EstadoAssinatura = (typeof ESTADOS_ASSINATURA)[number];
export type Plano = 'pro' | 'free';

// Colunas de `assinatura` que as regras de tempo usam (design, modelo de dados).
export interface SituacaoAssinatura {
  status: EstadoAssinatura;
  periodo_fim: Date | string;
  vencimento_atraso: Date | string | null;
}

// PLANO-01: só estas transições. O mesmo estado não é transição (a renovação de `ativa` muda só
// `periodo_fim`, sem passar por aqui).
export const TRANSICOES_ASSINATURA: Record<EstadoAssinatura, readonly EstadoAssinatura[]> = {
  trial: ['ativa', 'free'],
  ativa: ['atrasada', 'cancelada'],
  atrasada: ['ativa', 'free'],
  cancelada: ['free'],
  free: ['ativa'],
};

export type ResultadoTransicaoAssinatura = 'permitida' | 'transicao_invalida';

export const avaliarTransicaoAssinatura = (
  de: EstadoAssinatura,
  para: EstadoAssinatura,
): ResultadoTransicaoAssinatura =>
  TRANSICOES_ASSINATURA[de].includes(para) ? 'permitida' : 'transicao_invalida';

export const transicaoAssinaturaPermitida = (
  de: EstadoAssinatura,
  para: EstadoAssinatura,
): boolean => avaliarTransicaoAssinatura(de, para) === 'permitida';

// PLANO-10, D-21: 7 dias em `atrasada` contados do vencimento.
export const TOLERANCIA_ATRASO_MS = 7 * 24 * 60 * 60 * 1000;

const ms = (instante: Date | string): number => new Date(instante).getTime();
const noFuturo = (instante: Date | string, agora: Date): boolean => ms(instante) > agora.getTime();

// Esgotada quando já se passaram 7 dias completos (exatamente 7 dias conta como esgotada).
export const toleranciaEsgotada = (vencimento: Date | string, agora: Date): boolean =>
  agora.getTime() - ms(vencimento) >= TOLERANCIA_ATRASO_MS;

// Vencimento da tolerância: `vencimento_atraso` (gravado pelo webhook de cobrança vencida) ou, sem
// ele, `periodo_fim`, que é a data de vencimento da cobrança (PLANO-08).
const vencimentoDoAtraso = (a: SituacaoAssinatura): Date | string =>
  a.vencimento_atraso ?? a.periodo_fim;

// PLANO-04, PLANO-10, PLANO-11: estado para onde o tempo leva a assinatura (o cron aplica).
// trial ou cancelada sem `periodo_fim` no futuro e atrasada com a tolerância esgotada caem para
// `free`; os demais ficam como estão. Toda mudança devolvida é uma transição permitida.
export function estadoPorTempo(a: SituacaoAssinatura, agora: Date): EstadoAssinatura {
  switch (a.status) {
    case 'trial':
    case 'cancelada':
      return noFuturo(a.periodo_fim, agora) ? a.status : 'free';
    case 'atrasada':
      return toleranciaEsgotada(vencimentoDoAtraso(a), agora) ? 'free' : 'atrasada';
    default:
      return a.status;
  }
}

// PLANO-02: o Pro está liberado em trial e cancelada com `periodo_fim` no futuro, em ativa
// (a renovação vem do Asaas; a falta de pagamento chega pelo webhook e leva a `atrasada`) e em
// atrasada durante a tolerância (D-21: 7 dias "com aviso"). Free nunca.
// SPEC_DEVIATION: a PLANO-02 pode ser lida como "periodo_fim no futuro" valendo para os quatro
// estados; em `atrasada` isso anularia a tolerância (periodo_fim é o vencimento já passado), então
// ativa não olha periodo_fim e atrasada olha a tolerância.
export function proLiberado(a: SituacaoAssinatura, agora: Date): boolean {
  if (a.status === 'free') return false;
  if (a.status === 'ativa') return true;
  return estadoPorTempo(a, agora) !== 'free';
}

export const planoEfetivo = (a: SituacaoAssinatura, agora: Date): Plano =>
  proLiberado(a, agora) ? 'pro' : 'free';

// PLANO-03, D-20: no Free, até 5 pacientes ativos; com 5 ou mais, criar ou reativar paciente é
// recusado. No Pro não há limite.
export const LIMITE_PACIENTES_FREE = 5;

export const limitePacientes = (plano: Plano, ativos: number): 'ok' | 'LIMITE_PLANO' =>
  plano === 'free' && ativos >= LIMITE_PACIENTES_FREE ? 'LIMITE_PLANO' : 'ok';
