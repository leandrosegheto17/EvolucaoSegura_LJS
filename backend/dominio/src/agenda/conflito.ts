import type { StatusSessao } from '@es/contrato/agenda';

// AGE-04, AGE-06, AGE-09: conflito de horário e dia habilitado, regras puras copiadas de
// backend/src/scheduling/domain/{conflict,weekday-availability}.ts do legado. O conflito é aviso
// confirmável (a API responde 409 SCHEDULE_CONFLICT sem confirmar_conflito), nunca altera a
// sessão existente. No legado o dia da semana vinha do banco; aqui é calculado com o Intl, no
// fuso America/Sao_Paulo (datas de calendário da spec).

// Status que ainda ocupam o horário (espelha o índice parcial da migration 0007).
export const STATUS_QUE_OCUPAM: readonly StatusSessao[] = ['agendada', 'realizada', 'faltou'];

export interface Intervalo {
  inicio: Date;
  fim: Date;
}

// [início, fim): encostar (fim de um = início do outro) não é conflito.
export const sobrepoe = (a: Intervalo, b: Intervalo): boolean =>
  a.inicio < b.fim && b.inicio < a.fim;

// Ids das sessões existentes que ocupam o horário e colidem com o candidato, na ordem recebida.
// `ignorarId` tira a própria sessão (edição, reabertura).
export function conflitos<T extends Intervalo & { id: string; status: StatusSessao }>(
  candidato: Intervalo,
  existentes: readonly T[],
  ignorarId?: string,
): string[] {
  return existentes
    .filter(
      (e) => e.id !== ignorarId && STATUS_QUE_OCUPAM.includes(e.status) && sobrepoe(candidato, e),
    )
    .map((e) => e.id);
}

export interface FimDeSemana {
  sabado: boolean;
  domingo: boolean;
}

// AGE-06: dia ISO (1 = segunda ... 7 = domingo); segunda a sexta sempre; sábado e domingo
// dependem cada um do seu flag no perfil.
export function diaHabilitado(diaIso: number, fimDeSemana: FimDeSemana): boolean {
  if (diaIso === 6) return fimDeSemana.sabado;
  if (diaIso === 7) return fimDeSemana.domingo;
  return true;
}

export const FUSO_AGENDA = 'America/Sao_Paulo';
const DIAS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatoDia = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_AGENDA, weekday: 'short' });

export function diaDaSemanaIso(instante: Date): number {
  const dia = DIAS[formatoDia.format(instante)];
  if (dia === undefined) throw new Error('dia da semana desconhecido');
  return dia;
}

export const diaHabilitadoNoInstante = (instante: Date, fimDeSemana: FimDeSemana): boolean =>
  diaHabilitado(diaDaSemanaIso(instante), fimDeSemana);
