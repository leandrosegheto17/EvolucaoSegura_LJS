import { describe, expect, it } from 'vitest';
import {
  LIMITE_HOJE,
  estadoEvolucao,
  estadoPagamento,
  semanaDeAtendimento,
  ultimoDiaHabilitado,
} from './resumo.ts';

// T114 / INI-01, INI-02, INI-03: regras do resumo do Início, copiadas de
// backend/src/home/domain/summary.ts do legado (legado:summary.ts:115-124).
// - Evolução em quatro estados e pagamento em três (INI-03); os casos do summary.spec.ts do
//   legado vêm primeiro, iguais.
// - Semana de segunda até o último dia habilitado (INI-01).
// - Lista de hoje com no máximo 6 sessões (INI-02).

describe('testes do legado: estados do Início (summary.spec.ts)', () => {
  it('evolucao', () => {
    expect(estadoEvolucao('realizada', false, false)).toBe('editavel_hoje_sem_texto');
    expect(estadoEvolucao('agendada', false, false)).toBe('sem_registro');
    expect(estadoEvolucao('realizada', true, true)).toBe('editavel_hoje');
    expect(estadoEvolucao('realizada', true, false)).toBe('registrada');
  });

  it('pagamento (RN-07)', () => {
    expect(estadoPagamento('realizada', true, true)).toBe('pago');
    expect(estadoPagamento('realizada', false, false)).toBe('pendente');
    expect(estadoPagamento('faltou', true, false)).toBe('pendente');
    expect(estadoPagamento('faltou', false, false)).toBe('nao_cobravel');
    expect(estadoPagamento('agendada', true, false)).toBe('nao_cobravel');
  });
});

describe('testes do legado: último dia habilitado (T-220)', () => {
  it('4 combinações', () => {
    expect(ultimoDiaHabilitado({ sabado: false, domingo: false })).toBe(5);
    expect(ultimoDiaHabilitado({ sabado: true, domingo: false })).toBe(6);
    expect(ultimoDiaHabilitado({ sabado: false, domingo: true })).toBe(7);
    expect(ultimoDiaHabilitado({ sabado: true, domingo: true })).toBe(7);
  });
});

describe('estado da evolução: quatro estados (INI-03)', () => {
  it.each(['agendada', 'faltou', 'cancelada', 'remarcada'] as const)(
    '%s sem evolução: sem_registro',
    (status) => expect(estadoEvolucao(status, false, false)).toBe('sem_registro'),
  );

  it('com evolução, o estado vem da data da evolução, qualquer que seja o status', () => {
    expect(estadoEvolucao('agendada', true, true)).toBe('editavel_hoje');
    expect(estadoEvolucao('faltou', true, false)).toBe('registrada');
  });
});

describe('estado do pagamento: três estados (INI-03)', () => {
  it.each([
    ['realizada', false, false, 'pendente'],
    ['faltou', true, false, 'pendente'],
    ['cancelada', true, false, 'pendente'],
    ['cancelada', false, false, 'nao_cobravel'],
    ['agendada', false, false, 'nao_cobravel'],
    ['remarcada', true, false, 'nao_cobravel'],
    ['agendada', false, true, 'pago'],
    ['cancelada', true, true, 'pago'],
  ] as const)('%s cobravel=%s pago=%s -> %s', (status, cobravel, pago, esperado) => {
    expect(estadoPagamento(status, cobravel, pago)).toBe(esperado);
  });
});

describe('semana de segunda ao último dia habilitado (INI-01)', () => {
  const SEM_FIM_DE_SEMANA = { sabado: false, domingo: false };

  it('numa quarta: de segunda a sexta', () => {
    // 2026-10-28 é quarta-feira.
    expect(semanaDeAtendimento('2026-10-28', SEM_FIM_DE_SEMANA)).toEqual({
      inicio: '2026-10-26',
      fim: '2026-10-30',
    });
  });

  it('na própria segunda e no domingo, a semana é a mesma', () => {
    expect(semanaDeAtendimento('2026-10-26', SEM_FIM_DE_SEMANA).inicio).toBe('2026-10-26');
    expect(semanaDeAtendimento('2026-11-01', SEM_FIM_DE_SEMANA)).toEqual({
      inicio: '2026-10-26',
      fim: '2026-10-30',
    });
  });

  it('o fim acompanha sábado e domingo habilitados', () => {
    expect(semanaDeAtendimento('2026-10-28', { sabado: true, domingo: false }).fim).toBe(
      '2026-10-31',
    );
    expect(semanaDeAtendimento('2026-10-28', { sabado: false, domingo: true }).fim).toBe(
      '2026-11-01',
    );
  });

  it('atravessa mês e ano', () => {
    // 2027-01-01 é sexta-feira.
    expect(semanaDeAtendimento('2027-01-01', { sabado: true, domingo: true })).toEqual({
      inicio: '2026-12-28',
      fim: '2027-01-03',
    });
  });
});

describe('lista de hoje (INI-02)', () => {
  it('no máximo 6 sessões', () => {
    expect(LIMITE_HOJE).toBe(6);
  });
});
