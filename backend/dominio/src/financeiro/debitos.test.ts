import { describe, expect, it } from 'vitest';
import {
  agruparDebitos,
  pendenciasDoPaciente,
  decidirPagamento,
  emDebito,
  somarPendentes,
  valorDaSessao,
  valorDoPagamento,
} from './debitos.ts';

// T109 / FIN-04, FIN-05, FIN-06: regras de débito, pagamento e preço, copiadas de debts.ts,
// payment.ts e price.ts do legado em centavos inteiros (ADR-007).
// - Em débito: realizada sem pagamento; faltou ou cancelada cobrável sem pagamento; agendada e
//   remarcada nunca (FIN-06). Casos do debts.spec.ts do legado.
// - Valor da sessão: ajuste da sessão se houver, senão o preço do paciente (decisão do usuário de
//   2026-10-26; SPEC_DEVIATION da FIN-03, que fala só do preço do paciente).
// - Pagamento sem valor e sem preço é recusado: PRICE_REQUIRED (FIN-04).
// - Pagamento existente sem confirmar_duplicidade: PAYMENT_DUPLICATE; com ele, corrige (FIN-05).

describe('em débito (FIN-06)', () => {
  it.each([
    ['realizada', true, false, true],
    ['realizada', false, false, true],
    ['realizada', true, true, false],
    ['faltou', true, false, true],
    ['faltou', false, false, false],
    ['faltou', true, true, false],
    ['cancelada', true, false, true],
    ['cancelada', false, false, false],
    ['cancelada', true, true, false],
    ['agendada', true, false, false],
    ['agendada', false, false, false],
    ['remarcada', true, false, false],
    ['remarcada', false, false, false],
  ] as const)('%s cobravel=%s pago=%s -> %s', (status, cobravel, pago, esperado) => {
    expect(emDebito({ status, cobravel }, pago)).toBe(esperado);
  });
});

describe('valor da sessão (ajuste da sessão, senão preço do paciente)', () => {
  it('ajuste da sessão vence o preço do paciente', () => {
    expect(valorDaSessao(12000, 15000)).toBe(12000);
    expect(valorDaSessao(0, 15000)).toBe(0);
  });

  it('sem ajuste, o preço do paciente', () => {
    expect(valorDaSessao(null, 15000)).toBe(15000);
  });

  it('sem nenhum dos dois, null', () => {
    expect(valorDaSessao(null, null)).toBeNull();
  });
});

describe('valor do pagamento (FIN-03, FIN-04)', () => {
  it('valor informado prevalece, inclusive 0', () => {
    expect(valorDoPagamento(5000, 12000, 15000)).toBe(5000);
    expect(valorDoPagamento(0, null, null)).toBe(0);
  });

  it('sem valor usa o ajuste da sessão, senão o preço do paciente', () => {
    expect(valorDoPagamento(undefined, 12000, 15000)).toBe(12000);
    expect(valorDoPagamento(undefined, null, 15000)).toBe(15000);
  });

  it('sem valor e sem preço é recusado com PRICE_REQUIRED', () => {
    expect(valorDoPagamento(undefined, null, null)).toBe('PRICE_REQUIRED');
  });
});

describe('pagamento duplicado (FIN-05)', () => {
  it('sem pagamento, cria (com ou sem confirmação)', () => {
    expect(decidirPagamento(false, undefined)).toBe('criar');
    expect(decidirPagamento(false, true)).toBe('criar');
  });

  it('com pagamento e sem confirmar_duplicidade: PAYMENT_DUPLICATE', () => {
    expect(decidirPagamento(true, undefined)).toBe('PAYMENT_DUPLICATE');
    expect(decidirPagamento(true, false)).toBe('PAYMENT_DUPLICATE');
  });

  it('com pagamento e confirmar_duplicidade: corrige', () => {
    expect(decidirPagamento(true, true)).toBe('corrigir');
  });
});

describe('soma do pendente em centavos', () => {
  it('soma inteiros sem arredondar e trata sem preço como 0', () => {
    expect(somarPendentes([{ valor: 10 }, { valor: 20 }, { valor: null }])).toBe(30);
    expect(somarPendentes([{ valor: 9_999_999_999 }, { valor: 9_999_999_999 }])).toBe(
      19_999_999_998,
    );
    expect(somarPendentes([])).toBe(0);
  });
});

describe('débitos por paciente (FIN-06, FIN-07)', () => {
  const pacientes = [
    { id: 'p1', nome: 'Ana' },
    { id: 'p2', nome: 'Bruno' },
    { id: 'p3', nome: 'Carla' },
  ];
  // Candidatas: sessões sem pagamento; o domínio decide o que está em débito.
  const sessoes = [
    {
      sessao_id: 's1',
      paciente_id: 'p1',
      inicio: 'i1',
      status: 'realizada',
      cobravel: true,
      valor: 15000,
    },
    {
      sessao_id: 's2',
      paciente_id: 'p1',
      inicio: 'i2',
      status: 'faltou',
      cobravel: true,
      valor: null,
    },
    {
      sessao_id: 's3',
      paciente_id: 'p1',
      inicio: 'i3',
      status: 'faltou',
      cobravel: false,
      valor: 15000,
    },
    {
      sessao_id: 's4',
      paciente_id: 'p2',
      inicio: 'i4',
      status: 'cancelada',
      cobravel: true,
      valor: 8000,
    },
    {
      sessao_id: 's5',
      paciente_id: 'p3',
      inicio: 'i5',
      status: 'agendada',
      cobravel: true,
      valor: 9000,
    },
  ];

  it('todos: cada paciente com situação, contagem, valor e o total da lista', () => {
    expect(agruparDebitos(pacientes, sessoes, undefined)).toEqual({
      items: [
        {
          paciente_id: 'p1',
          nome: 'Ana',
          status: 'em_debito',
          sessoes_pendentes: 2,
          valor_pendente: 15000,
        },
        {
          paciente_id: 'p2',
          nome: 'Bruno',
          status: 'em_debito',
          sessoes_pendentes: 1,
          valor_pendente: 8000,
        },
        {
          paciente_id: 'p3',
          nome: 'Carla',
          status: 'em_dia',
          sessoes_pendentes: 0,
          valor_pendente: 0,
        },
      ],
      total_pendente: 23000,
    });
  });

  it('filtro em_debito', () => {
    const lista = agruparDebitos(pacientes, sessoes, 'em_debito');
    expect(lista.items.map((i) => i.paciente_id)).toEqual(['p1', 'p2']);
    expect(lista.total_pendente).toBe(23000);
  });

  it('filtro em_dia', () => {
    const lista = agruparDebitos(pacientes, sessoes, 'em_dia');
    expect(lista.items.map((i) => i.paciente_id)).toEqual(['p3']);
    expect(lista.total_pendente).toBe(0);
  });

  it('pendências de um paciente: só as sessões em débito dele, com total', () => {
    expect(pendenciasDoPaciente(pacientes[0]!, sessoes)).toEqual({
      paciente_id: 'p1',
      nome: 'Ana',
      sessoes: [
        { sessao_id: 's1', inicio: 'i1', status: 'realizada', valor: 15000 },
        { sessao_id: 's2', inicio: 'i2', status: 'faltou', valor: null },
      ],
      total_sessoes: 2,
      valor_pendente: 15000,
    });
    expect(pendenciasDoPaciente(pacientes[2]!, sessoes)).toEqual({
      paciente_id: 'p3',
      nome: 'Carla',
      sessoes: [],
      total_sessoes: 0,
      valor_pendente: 0,
    });
  });
});
