import { describe, expect, it } from 'vitest';
import { deslocarAPartirDe, gerarOcorrencias, ocorrenciasValidas } from './serie.ts';

// T83 / AGE-13, AGE-15: série semanal ou quinzenal de 2 a 52 ocorrências (a primeira incluída),
// todas com a mesma duração, e o deslocamento "a partir de" uma data, que só move as ocorrências
// `agendada` com início na data ou depois dela. Casos do legado (series.spec.ts) vêm junto.

const d = (texto: string) => new Date(texto);
const PRIMEIRA = { inicio: d('2026-03-10T13:00:00Z'), fim: d('2026-03-10T13:50:00Z') };
const iso = (intervalos: { inicio: Date; fim: Date }[]) =>
  intervalos.map((i) => [i.inicio.toISOString(), i.fim.toISOString()]);

describe('quantidade de ocorrências (AGE-13)', () => {
  it('1 e 53 são recusadas; 2 e 52 são aceitas', () => {
    expect(ocorrenciasValidas(1)).toBe(false);
    expect(ocorrenciasValidas(53)).toBe(false);
    expect(ocorrenciasValidas(2)).toBe(true);
    expect(ocorrenciasValidas(52)).toBe(true);
  });

  it('zero, negativo e fracionário são recusados', () => {
    expect(ocorrenciasValidas(0)).toBe(false);
    expect(ocorrenciasValidas(-2)).toBe(false);
    expect(ocorrenciasValidas(2.5)).toBe(false);
  });

  it('gerar com 1 ou 53 lança erro em vez de gerar uma série fora do limite', () => {
    expect(() => gerarOcorrencias(PRIMEIRA, 'semanal', 1)).toThrow(RangeError);
    expect(() => gerarOcorrencias(PRIMEIRA, 'semanal', 53)).toThrow(RangeError);
  });

  it('gera exatamente 2 e exatamente 52, a primeira incluída', () => {
    const duas = gerarOcorrencias(PRIMEIRA, 'semanal', 2);
    expect(iso(duas)).toEqual([
      ['2026-03-10T13:00:00.000Z', '2026-03-10T13:50:00.000Z'],
      ['2026-03-17T13:00:00.000Z', '2026-03-17T13:50:00.000Z'],
    ]);
    const cinquentaEDuas = gerarOcorrencias(PRIMEIRA, 'semanal', 52);
    expect(cinquentaEDuas).toHaveLength(52);
    expect(cinquentaEDuas[0]!.inicio.toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(cinquentaEDuas[51]!.inicio.toISOString()).toBe('2027-03-02T13:00:00.000Z');
  });
});

describe('frequência e duração (AGE-13)', () => {
  it('semanal: uma ocorrência a cada 7 dias, mantendo a duração (caso do legado)', () => {
    const s = gerarOcorrencias(PRIMEIRA, 'semanal', 4);
    expect(iso(s)).toEqual([
      ['2026-03-10T13:00:00.000Z', '2026-03-10T13:50:00.000Z'],
      ['2026-03-17T13:00:00.000Z', '2026-03-17T13:50:00.000Z'],
      ['2026-03-24T13:00:00.000Z', '2026-03-24T13:50:00.000Z'],
      ['2026-03-31T13:00:00.000Z', '2026-03-31T13:50:00.000Z'],
    ]);
  });

  it('quinzenal pula uma semana: a cada 14 dias (caso do legado)', () => {
    const s = gerarOcorrencias(
      { inicio: d('2026-03-10T13:00:00Z'), fim: d('2026-03-10T14:00:00Z') },
      'quinzenal',
      3,
    );
    expect(iso(s)).toEqual([
      ['2026-03-10T13:00:00.000Z', '2026-03-10T14:00:00.000Z'],
      ['2026-03-24T13:00:00.000Z', '2026-03-24T14:00:00.000Z'],
      ['2026-04-07T13:00:00.000Z', '2026-04-07T14:00:00.000Z'],
    ]);
  });

  it('todas as ocorrências têm a mesma duração da primeira', () => {
    const s = gerarOcorrencias(
      { inicio: d('2026-11-10T13:00:00Z'), fim: d('2026-11-10T14:30:00Z') },
      'quinzenal',
      26,
    );
    expect(new Set(s.map((o) => o.fim.getTime() - o.inicio.getTime()))).toEqual(
      new Set([90 * 60_000]),
    );
  });
});

describe('deslocar a partir de uma data (AGE-15)', () => {
  // Série semanal de 5 às terças 13:00Z; a 2ª já realizada, a 4ª cancelada.
  const serie = [
    {
      id: 'a',
      status: 'agendada',
      inicio: d('2026-03-03T13:00:00Z'),
      fim: d('2026-03-03T13:50:00Z'),
    },
    {
      id: 'b',
      status: 'realizada',
      inicio: d('2026-03-10T13:00:00Z'),
      fim: d('2026-03-10T13:50:00Z'),
    },
    {
      id: 'c',
      status: 'agendada',
      inicio: d('2026-03-17T13:00:00Z'),
      fim: d('2026-03-17T13:50:00Z'),
    },
    {
      id: 'd',
      status: 'cancelada',
      inicio: d('2026-03-24T13:00:00Z'),
      fim: d('2026-03-24T13:50:00Z'),
    },
    {
      id: 'e',
      status: 'agendada',
      inicio: d('2026-03-31T13:00:00Z'),
      fim: d('2026-03-31T13:50:00Z'),
    },
  ] as const;

  it('move só as agendada com início na data ou depois, pela diferença da primeira delas', () => {
    // A partir de 10/03: a primeira agendada é "c" (17/03 13:00) e passa para quarta 18/03 15:00,
    // com 60 minutos; "e" anda o mesmo tanto.
    const plano = deslocarAPartirDe(serie, d('2026-03-10T00:00:00Z'), {
      inicio: d('2026-03-18T15:00:00Z'),
      fim: d('2026-03-18T16:00:00Z'),
    });
    expect(plano.map((p) => [p.id, p.inicio.toISOString(), p.fim.toISOString()])).toEqual([
      ['c', '2026-03-18T15:00:00.000Z', '2026-03-18T16:00:00.000Z'],
      ['e', '2026-04-01T15:00:00.000Z', '2026-04-01T16:00:00.000Z'],
    ]);
  });

  it('ocorrências anteriores à data, realizadas e canceladas ficam fora do plano', () => {
    const plano = deslocarAPartirDe(serie, d('2026-03-10T00:00:00Z'), {
      inicio: d('2026-03-18T15:00:00Z'),
      fim: d('2026-03-18T16:00:00Z'),
    });
    const ids = plano.map((p) => p.id);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('d');
  });

  it('a ocorrência que começa exatamente na data entra no deslocamento', () => {
    const plano = deslocarAPartirDe(serie, d('2026-03-17T13:00:00Z'), {
      inicio: d('2026-03-17T14:00:00Z'),
      fim: d('2026-03-17T14:50:00Z'),
    });
    expect(plano.map((p) => [p.id, p.inicio.toISOString()])).toEqual([
      ['c', '2026-03-17T14:00:00.000Z'],
      ['e', '2026-03-31T14:00:00.000Z'],
    ]);
  });

  it('a ordem de entrada não importa: a referência é a agendada mais cedo a partir da data', () => {
    const embaralhada = [serie[4], serie[0], serie[2], serie[3], serie[1]];
    const plano = deslocarAPartirDe(embaralhada, d('2026-03-10T00:00:00Z'), {
      inicio: d('2026-03-18T15:00:00Z'),
      fim: d('2026-03-18T16:00:00Z'),
    });
    expect(plano.map((p) => [p.id, p.inicio.toISOString()])).toEqual([
      ['c', '2026-03-18T15:00:00.000Z'],
      ['e', '2026-04-01T15:00:00.000Z'],
    ]);
  });

  it('sem agendada a partir da data, o plano é vazio', () => {
    expect(
      deslocarAPartirDe(serie, d('2026-04-01T00:00:00Z'), {
        inicio: d('2026-04-01T15:00:00Z'),
        fim: d('2026-04-01T16:00:00Z'),
      }),
    ).toEqual([]);
  });
});
