import {
  type FrequenciaSerie,
  OCORRENCIAS_MAXIMO,
  OCORRENCIAS_MINIMO,
  type StatusSessao,
} from '@es/contrato/agenda';
import type { Intervalo } from './conflito.ts';

// AGE-13, AGE-15: regras puras da série, copiadas de backend/src/scheduling/domain/series.ts do
// legado (generateSlots) e do deslocamento de SeriesService.update. O passo de 7 ou 14 dias é
// contado em UTC, como no legado (America/Sao_Paulo está sem horário de verão desde 2019, então a
// hora local se mantém).

const DIA_MS = 86_400_000;

export const passoEmDias = (frequencia: FrequenciaSerie): number =>
  frequencia === 'semanal' ? 7 : 14;

export const ocorrenciasValidas = (n: number): boolean =>
  Number.isInteger(n) && n >= OCORRENCIAS_MINIMO && n <= OCORRENCIAS_MAXIMO;

// N ocorrências (a primeira incluída), espaçadas pelo passo, todas com a duração da primeira.
export function gerarOcorrencias(
  primeira: Intervalo,
  frequencia: FrequenciaSerie,
  n: number,
): Intervalo[] {
  if (!ocorrenciasValidas(n))
    throw new RangeError(
      `a série tem de ${OCORRENCIAS_MINIMO} a ${OCORRENCIAS_MAXIMO} ocorrências`,
    );
  const passo = passoEmDias(frequencia) * DIA_MS;
  return Array.from({ length: n }, (_, i) => ({
    inicio: new Date(primeira.inicio.getTime() + i * passo),
    fim: new Date(primeira.fim.getTime() + i * passo),
  }));
}

export interface Ocorrencia extends Intervalo {
  id: string;
  status: StatusSessao;
}

export interface Deslocamento extends Intervalo {
  id: string;
  // Início antes do deslocamento (a API reaplica o dia habilitado só quando o início muda).
  inicioAnterior: Date;
}

// Só as ocorrências `agendada` com início na data ou depois dela, da mais cedo para a mais tarde.
export const abertasAPartirDe = <T extends Ocorrencia>(
  ocorrencias: readonly T[],
  aPartirDe: Date,
): T[] =>
  ocorrencias
    .filter((o) => o.status === 'agendada' && o.inicio.getTime() >= aPartirDe.getTime())
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.id.localeCompare(b.id));

// A primeira ocorrência aberta vai para `novo`; as demais andam a mesma diferença e todas ficam
// com a duração de `novo`. Sem ocorrência aberta, o plano é vazio.
export function deslocarAPartirDe(
  ocorrencias: readonly Ocorrencia[],
  aPartirDe: Date,
  novo: Intervalo,
): Deslocamento[] {
  const abertas = abertasAPartirDe(ocorrencias, aPartirDe);
  const referencia = abertas[0];
  if (!referencia) return [];
  const diferenca = novo.inicio.getTime() - referencia.inicio.getTime();
  const duracao = novo.fim.getTime() - novo.inicio.getTime();
  return abertas.map((o) => {
    const inicio = new Date(o.inicio.getTime() + diferenca);
    return {
      id: o.id,
      inicio,
      fim: new Date(inicio.getTime() + duracao),
      inicioAnterior: o.inicio,
    };
  });
}
