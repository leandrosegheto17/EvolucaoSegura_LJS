import { STATUS_SESSAO, type StatusSessao } from '@es/contrato/agenda';
import { describe, expect, it } from 'vitest';
import { avaliarTransicao, cobravelApos, reabreHorario, transicaoPermitida } from './sessao.ts';

// T76 / AGE-07, AGE-08, AGE-09, AGE-10: transições de status da sessão. A matriz da spec (a do
// legado, mais realizada para cancelada), mesmo status idempotente, realizada para cancelada
// recusada quando a sessão tem evolução ou pagamento, e falta ou cancelamento gravando
// cobravel = false salvo "cobrar". Casos do T-163 do legado
// (backend/src/scheduling/domain/session.spec.ts) vêm junto, com realizada para cancelada agora
// permitida.

// AGE-07, escrita a partir da spec.
const PERMITIDAS: Record<StatusSessao, StatusSessao[]> = {
  agendada: ['realizada', 'faltou', 'cancelada', 'remarcada'],
  realizada: ['agendada', 'faltou', 'cancelada'],
  faltou: ['agendada', 'realizada'],
  cancelada: ['agendada'],
  remarcada: ['agendada'],
};

const pares = STATUS_SESSAO.flatMap((de) => STATUS_SESSAO.map((para) => [de, para] as const));

describe('matriz de transições (AGE-07)', () => {
  it.each(pares.filter(([de, para]) => de !== para && PERMITIDAS[de].includes(para)))(
    '%s -> %s é aceita',
    (de, para) => {
      expect(transicaoPermitida(de, para, false)).toBe(true);
      expect(avaliarTransicao(de, para, false)).toBe('permitida');
    },
  );

  it.each(pares.filter(([de, para]) => de !== para && !PERMITIDAS[de].includes(para)))(
    '%s -> %s é recusada',
    (de, para) => {
      expect(transicaoPermitida(de, para, false)).toBe(false);
      expect(avaliarTransicao(de, para, false)).toBe('transicao_invalida');
      expect(avaliarTransicao(de, para, true)).toBe('transicao_invalida');
    },
  );

  it('são 11 transições aceitas e 9 recusadas entre status diferentes', () => {
    const diferentes = pares.filter(([de, para]) => de !== para);
    expect(diferentes.filter(([de, para]) => transicaoPermitida(de, para, false))).toHaveLength(11);
    expect(diferentes.filter(([de, para]) => !transicaoPermitida(de, para, false))).toHaveLength(9);
  });

  it('casos do legado: cancelada e remarcada só reabrem; agendada vai a qualquer outro', () => {
    expect(transicaoPermitida('cancelada', 'realizada', false)).toBe(false);
    expect(transicaoPermitida('cancelada', 'faltou', false)).toBe(false);
    expect(transicaoPermitida('remarcada', 'realizada', false)).toBe(false);
    for (const para of STATUS_SESSAO)
      expect(transicaoPermitida('agendada', para, false)).toBe(true);
  });
});

describe('mesmo status é idempotente (AGE-07)', () => {
  it.each(STATUS_SESSAO)('%s -> %s é aceita como mesmo status', (status) => {
    expect(transicaoPermitida(status, status, false)).toBe(true);
    expect(transicaoPermitida(status, status, true)).toBe(true);
    expect(avaliarTransicao(status, status, false)).toBe('mesmo_status');
    expect(avaliarTransicao(status, status, true)).toBe('mesmo_status');
  });
});

describe('realizada para cancelada com registros (AGE-08)', () => {
  it('sem evolução nem pagamento, cancela', () => {
    expect(avaliarTransicao('realizada', 'cancelada', false)).toBe('permitida');
    expect(transicaoPermitida('realizada', 'cancelada', false)).toBe(true);
  });

  it('com evolução ou pagamento, recusa com SESSION_HAS_RECORDS', () => {
    expect(avaliarTransicao('realizada', 'cancelada', true)).toBe('SESSION_HAS_RECORDS');
    expect(transicaoPermitida('realizada', 'cancelada', true)).toBe(false);
  });

  it('a guarda vale só para realizada -> cancelada', () => {
    expect(avaliarTransicao('agendada', 'cancelada', true)).toBe('permitida');
    expect(avaliarTransicao('realizada', 'faltou', true)).toBe('permitida');
    expect(avaliarTransicao('realizada', 'agendada', true)).toBe('permitida');
  });
});

describe('cobravel (AGE-10)', () => {
  it.each(['faltou', 'cancelada'] as const)(
    'virar %s grava cobravel = false sem "cobrar", mesmo se antes era true',
    (para) => {
      for (const de of STATUS_SESSAO.filter((s) => s !== para)) {
        expect(cobravelApos(de, para, undefined, false), de).toBe(false);
        expect(cobravelApos(de, para, undefined, true), de).toBe(false);
        expect(cobravelApos(de, para, false, true), de).toBe(false);
      }
    },
  );

  it.each(['faltou', 'cancelada'] as const)(
    'virar %s com "cobrar" grava cobravel = true',
    (para) => {
      for (const de of STATUS_SESSAO.filter((s) => s !== para))
        expect(cobravelApos(de, para, true, false), de).toBe(true);
    },
  );

  it('mesmo status: sem "cobrar" mantém o atual; com ele, troca só o cobravel', () => {
    expect(cobravelApos('faltou', 'faltou', undefined, true)).toBe(true);
    expect(cobravelApos('faltou', 'faltou', undefined, false)).toBe(false);
    expect(cobravelApos('faltou', 'faltou', true, false)).toBe(true);
    expect(cobravelApos('cancelada', 'cancelada', false, true)).toBe(false);
  });

  it('outros destinos mantêm o atual quando "cobrar" não vem', () => {
    expect(cobravelApos('faltou', 'agendada', undefined, true)).toBe(true);
    expect(cobravelApos('agendada', 'realizada', undefined, false)).toBe(false);
    expect(cobravelApos('agendada', 'remarcada', true, false)).toBe(true);
  });
});

describe('reabrir o horário (AGE-09)', () => {
  it('cancelada ou remarcada voltando a agendada reaplica as checagens', () => {
    expect(reabreHorario('cancelada', 'agendada')).toBe(true);
    expect(reabreHorario('remarcada', 'agendada')).toBe(true);
  });

  it('as demais transições não reabrem', () => {
    expect(reabreHorario('faltou', 'agendada')).toBe(false);
    expect(reabreHorario('realizada', 'agendada')).toBe(false);
    expect(reabreHorario('agendada', 'agendada')).toBe(false);
    expect(reabreHorario('cancelada', 'cancelada')).toBe(false);
  });
});
