import { STATUS_SESSAO } from '@es/contrato/agenda';
import { describe, expect, it } from 'vitest';
import {
  STATUS_QUE_OCUPAM,
  conflitos,
  diaDaSemanaIso,
  diaHabilitado,
  diaHabilitadoNoInstante,
  sobrepoe,
} from './conflito.ts';

// T77 / AGE-04, AGE-06, AGE-09: conflito de horário e dia habilitado. Intervalos [início, fim)
// que só se encostam não conflitam; só sessões agendada, realizada ou faltou ocupam o horário;
// sábado e domingo desligados no perfil são recusados, cada um pelo seu flag, com o dia contado
// em America/Sao_Paulo. Casos do legado (conflict.spec.ts e weekday-availability.spec.ts) vêm
// junto.

const h = (hora: number, minuto = 0) => new Date(Date.UTC(2026, 2, 2, hora, minuto));
const faixa = (de: number, ate: number) => ({ inicio: h(de), fim: h(ate) });
const sessao = (id: string, de: number, ate: number, status: (typeof STATUS_SESSAO)[number]) => ({
  id,
  status,
  ...faixa(de, ate),
});

describe('sobreposição [início, fim) (AGE-04)', () => {
  it('detecta sobreposição parcial, contida, que contém e idêntica', () => {
    expect(sobrepoe(faixa(10, 11), { inicio: h(10, 30), fim: h(11, 30) })).toBe(true);
    expect(sobrepoe(faixa(10, 12), faixa(10, 11))).toBe(true);
    expect(sobrepoe(faixa(10, 11), faixa(9, 12))).toBe(true);
    expect(sobrepoe(faixa(10, 11), faixa(10, 11))).toBe(true);
    expect(sobrepoe(faixa(10, 11), { inicio: h(9, 59), fim: h(10, 1) })).toBe(true);
  });

  it('intervalos que apenas se encostam não conflitam, nos dois sentidos', () => {
    expect(sobrepoe(faixa(10, 11), faixa(11, 12))).toBe(false);
    expect(sobrepoe(faixa(11, 12), faixa(10, 11))).toBe(false);
  });

  it('intervalos separados não conflitam', () => {
    expect(sobrepoe(faixa(10, 11), faixa(12, 13))).toBe(false);
  });
});

describe('conflitos (AGE-04)', () => {
  it('só agendada, realizada ou faltou ocupam o horário', () => {
    expect([...STATUS_QUE_OCUPAM]).toEqual(['agendada', 'realizada', 'faltou']);
    const existentes = STATUS_SESSAO.map((status) => sessao(status, 10, 11, status));
    expect(conflitos(faixa(10, 11), existentes)).toEqual(['agendada', 'realizada', 'faltou']);
  });

  it('cancelada e remarcada no mesmo horário não conflitam', () => {
    expect(
      conflitos(faixa(10, 11), [
        sessao('c', 10, 11, 'cancelada'),
        sessao('r', 10, 11, 'remarcada'),
      ]),
    ).toEqual([]);
  });

  it('lista todas as colisões e ignora as que só encostam', () => {
    const existentes = [
      sessao('a', 9, 10, 'agendada'),
      sessao('b', 10, 11, 'realizada'),
      sessao('c', 11, 12, 'faltou'),
      sessao('d', 10, 13, 'agendada'),
    ];
    expect(conflitos(faixa(10, 11), existentes)).toEqual(['b', 'd']);
  });

  it('ignora a própria sessão (edição e reabertura)', () => {
    const existentes = [sessao('a', 10, 11, 'agendada'), sessao('b', 12, 13, 'agendada')];
    expect(conflitos(faixa(10, 11), existentes)).toEqual(['a']);
    expect(conflitos(faixa(10, 11), existentes, 'a')).toEqual([]);
  });
});

describe('dia habilitado (AGE-06)', () => {
  const desligados = { sabado: false, domingo: false };

  it('segunda a sexta nunca são recusadas', () => {
    for (const dia of [1, 2, 3, 4, 5]) expect(diaHabilitado(dia, desligados)).toBe(true);
  });

  it('sábado e domingo desligados são recusados', () => {
    expect(diaHabilitado(6, desligados)).toBe(false);
    expect(diaHabilitado(7, desligados)).toBe(false);
  });

  it('sábado e domingo dependem cada um do seu flag', () => {
    expect(diaHabilitado(6, { sabado: true, domingo: false })).toBe(true);
    expect(diaHabilitado(7, { sabado: true, domingo: false })).toBe(false);
    expect(diaHabilitado(7, { sabado: false, domingo: true })).toBe(true);
    expect(diaHabilitado(6, { sabado: false, domingo: true })).toBe(false);
    expect(diaHabilitado(6, { sabado: true, domingo: true })).toBe(true);
  });
});

describe('dia da semana em America/Sao_Paulo', () => {
  it('conta o dia no fuso de São Paulo, não em UTC', () => {
    // Sábado 2026-11-07 às 23:30 em São Paulo = domingo 02:30 em UTC.
    expect(diaDaSemanaIso(new Date('2026-11-07T23:30:00-03:00'))).toBe(6);
    // Domingo 2026-11-08 às 22:00 em São Paulo = segunda 01:00 em UTC.
    expect(diaDaSemanaIso(new Date('2026-11-08T22:00:00-03:00'))).toBe(7);
    // Segunda 2026-11-09 às 00:30 em São Paulo = segunda 03:30 em UTC.
    expect(diaDaSemanaIso(new Date('2026-11-09T00:30:00-03:00'))).toBe(1);
    // Sexta 2026-11-06 às 23:59 em São Paulo.
    expect(diaDaSemanaIso(new Date('2026-11-07T02:59:00Z'))).toBe(5);
  });

  it('recusa no instante a sessão do sábado desligado, mesmo caindo no domingo em UTC', () => {
    const sabadoTarde = new Date('2026-11-07T23:30:00-03:00');
    expect(diaHabilitadoNoInstante(sabadoTarde, { sabado: false, domingo: true })).toBe(false);
    expect(diaHabilitadoNoInstante(sabadoTarde, { sabado: true, domingo: false })).toBe(true);
    expect(
      diaHabilitadoNoInstante(new Date('2026-11-10T13:00:00Z'), { sabado: false, domingo: false }),
    ).toBe(true);
  });
});
