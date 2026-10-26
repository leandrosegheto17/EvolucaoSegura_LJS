import { describe, expect, it } from 'vitest';
import {
  PROBLEMA_PERIODO_INVALIDO,
  PROBLEMA_PRONTUARIO_NAO_ENCONTRADO,
  esquemaConsultaProntuario,
} from './exportacao.ts';

// T121 / EXP-01, EXP-07: período opcional do prontuário. `de` e `ate` em YYYY-MM-DD, datas de
// calendário reais, com de ≤ até; ausentes = sem limite daquele lado. Fora disso (ou parâmetro
// desconhecido), 400. Adaptado de validDate e da checagem de record-export.service.ts do legado.

const ler = (consulta: Record<string, string>) => esquemaConsultaProntuario.safeParse(consulta);

describe('período do prontuário (EXP-01)', () => {
  it('sem período: prontuário completo', () => {
    expect(ler({})).toEqual({ success: true, data: { de: null, ate: null } });
  });

  it('só de, só até, ou os dois', () => {
    expect(ler({ de: '2026-10-01' }).data).toEqual({ de: '2026-10-01', ate: null });
    expect(ler({ ate: '2026-10-31' }).data).toEqual({ de: null, ate: '2026-10-31' });
    expect(ler({ de: '2026-10-01', ate: '2026-10-31' }).data).toEqual({
      de: '2026-10-01',
      ate: '2026-10-31',
    });
  });

  it('de igual a até vale (um dia só)', () => {
    expect(ler({ de: '2026-10-09', ate: '2026-10-09' }).success).toBe(true);
  });

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(ler({ de: '2028-02-29' }).success).toBe(true);
  });
});

describe('período inválido (EXP-07)', () => {
  it('de depois de até', () => {
    expect(ler({ de: '2026-05-02', ate: '2026-05-01' }).success).toBe(false);
  });

  it.each([
    '2026-13-40',
    '2026-13-01',
    '2026-02-30',
    '2027-02-29',
    '2026-1-01',
    '26-10-01',
    '2026/10/01',
    '01/10/2026',
    'abc',
    '',
    ' 2026-10-01',
    '2026-10-01T00:00:00Z',
  ])('data fora do formato ou inexistente: %j', (data) => {
    expect(ler({ de: data }).success).toBe(false);
    expect(ler({ ate: data }).success).toBe(false);
  });

  it('parâmetro desconhecido é recusado', () => {
    expect(ler({ de: '2026-10-01', usuario_id: 'x' }).success).toBe(false);
    expect(ler({ até: '2026-10-01' }).success).toBe(false);
  });
});

describe('problemas', () => {
  it('período inválido = 400 e paciente não encontrado = 404', () => {
    expect(PROBLEMA_PERIODO_INVALIDO).toEqual({
      tipo: 'about:blank',
      titulo: 'Período inválido',
      status: 400,
      codigo: 'periodo_invalido',
    });
    expect(PROBLEMA_PRONTUARIO_NAO_ENCONTRADO).toEqual({
      tipo: 'about:blank',
      titulo: 'Não encontrado',
      status: 404,
      codigo: 'nao_encontrado',
    });
  });
});
