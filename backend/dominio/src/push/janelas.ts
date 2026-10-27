// PUSH-02, PUSH-03, PUSH-04 (D-22, D-23; ADR-010): janelas de envio do push. Regras puras, sem
// origem no legado (ele não tinha push). O tempo vem sempre por parâmetro: o cron passa o horário
// agendado, de 5 em 5 minutos.
// - Sessão próxima: o aviso sai quando faltam de 15 a 10 minutos para o início, os dois limites
//   inclusive. Com o cron de 5 em 5 minutos, toda sessão cai em uma ou duas execuções; a chave em
//   notificacao_enviada garante um envio só.
// - Pendência: das 20:00 às 21:00 (exclusivo) em America/Sao_Paulo. PREMISSA: a hora seguinte é a
//   compensação de execução perdida (ADR-010); a chave do dia garante um envio por dia.
// - Trial: termina em 3 dias, de periodo_fim - 72 h (inclusive) até periodo_fim (exclusivo).
// - Chaves (tipo, ref) de notificacao_enviada (migration 0017): por sessão, por dia de Brasília e
//   por evento.

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export const FUSO_BRASILIA = 'America/Sao_Paulo';

export const ANTECEDENCIA_MAXIMA_SESSAO_MS = 15 * MIN;
export const ANTECEDENCIA_MINIMA_SESSAO_MS = 10 * MIN;
export const HORA_PENDENCIA = 20;
export const JANELA_PENDENCIA_MS = HORA;
export const ANTECEDENCIA_TRIAL_MS = 3 * DIA;

export type TipoNotificacao =
  | 'sessao_proxima'
  | 'evolucao_pendente'
  | 'cobranca_gerada'
  | 'pagamento_confirmado'
  | 'cobranca_vencida'
  | 'trial_terminando';

export type TipoEventoCobranca = 'cobranca_gerada' | 'pagamento_confirmado' | 'cobranca_vencida';

export interface ChaveNotificacao {
  tipo: TipoNotificacao;
  ref: string;
}

const ms = (instante: Date | string): number => new Date(instante).getTime();

// PUSH-02: faltam de 15 a 10 minutos (inclusive) para o início.
export function emJanelaSessaoProxima(inicio: Date | string, agora: Date): boolean {
  const falta = ms(inicio) - agora.getTime();
  return falta >= ANTECEDENCIA_MINIMA_SESSAO_MS && falta <= ANTECEDENCIA_MAXIMA_SESSAO_MS;
}

// Inícios de sessão que estão na janela nesta execução: [agora + 10 min, agora + 15 min].
export function intervaloSessaoProxima(agora: Date): { de: Date; ate: Date } {
  return {
    de: new Date(agora.getTime() + ANTECEDENCIA_MINIMA_SESSAO_MS),
    ate: new Date(agora.getTime() + ANTECEDENCIA_MAXIMA_SESSAO_MS),
  };
}

const formatoBrasilia = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_BRASILIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partesEmBrasilia(instante: Date): Record<string, string> {
  const partes: Record<string, string> = {};
  for (const { type, value } of formatoBrasilia.formatToParts(instante)) partes[type] = value;
  return partes;
}

// Dia de calendário em America/Sao_Paulo, 'YYYY-MM-DD'.
export function diaEmBrasilia(instante: Date): string {
  const p = partesEmBrasilia(instante);
  return `${p['year']}-${p['month']}-${p['day']}`;
}

// Milissegundos desde a meia-noite de Brasília (o fuso tem deslocamento de horas inteiras).
function msDoDiaEmBrasilia(instante: Date): number {
  const p = partesEmBrasilia(instante);
  return (
    Number(p['hour']) * HORA +
    Number(p['minute']) * MIN +
    Number(p['second']) * 1000 +
    instante.getUTCMilliseconds()
  );
}

// PUSH-03: das 20:00 (inclusive) às 21:00 (exclusivo) de Brasília.
export function emJanelaPendencia(agora: Date): boolean {
  const noDia = msDoDiaEmBrasilia(agora);
  const inicio = HORA_PENDENCIA * HORA;
  return noDia >= inicio && noDia < inicio + JANELA_PENDENCIA_MS;
}

// PUSH-04: o trial termina em 3 dias (de fim - 72 h, inclusive, até o fim, exclusivo).
export function emJanelaTrialTerminando(periodoFim: Date | string, agora: Date): boolean {
  const falta = ms(periodoFim) - agora.getTime();
  return falta > 0 && falta <= ANTECEDENCIA_TRIAL_MS;
}

// Uma vez por sessão.
export const chaveSessaoProxima = (sessaoId: string): ChaveNotificacao => ({
  tipo: 'sessao_proxima',
  ref: sessaoId,
});

// Uma vez por dia de Brasília.
export const chaveEvolucaoPendente = (agora: Date): ChaveNotificacao => ({
  tipo: 'evolucao_pendente',
  ref: diaEmBrasilia(agora),
});

// Uma vez por evento: o trial que termina em periodo_fim.
export const chaveTrialTerminando = (periodoFim: Date | string): ChaveNotificacao => ({
  tipo: 'trial_terminando',
  ref: new Date(periodoFim).toISOString(),
});

// Uma vez por evento: cada tipo de evento de uma cobrança.
export const chaveEventoCobranca = (
  tipo: TipoEventoCobranca,
  idCobranca: string,
): ChaveNotificacao => ({ tipo, ref: idCobranca });
