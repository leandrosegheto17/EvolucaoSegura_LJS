import { describe, expect, it } from 'vitest';
import { JANELA_SQL, estadoPorRelogio, serializarJanela } from './janela-edicao.ts';

// T99 / EVO-04, ANA-05: a janela de edição fecha à meia-noite de America/Sao_Paulo. Testes
// trazidos de clinical/domain/edit-window.spec.ts do legado (os de mapDbError e problem+json
// eram da plataforma NestJS e não se aplicam aqui).

describe('janela de edição (legado: edit-window.spec.ts)', () => {
  it('serializa editavel_hoje e editavel_ate ISO UTC', () => {
    expect(
      serializarJanela({ editavel_ate: new Date('2026-09-21T03:00:00Z'), editavel_hoje: true }),
    ).toEqual({ estado: 'editavel_hoje', editavel_ate: '2026-09-21T03:00:00.000Z' });
  });

  it('registrada quando fora do dia', () => {
    expect(
      serializarJanela({ editavel_ate: '2026-09-20T03:00:00Z', editavel_hoje: false }).estado,
    ).toBe('registrada');
  });

  it('relógio: a fronteira exata 00:00 de Brasília (03:00Z) fecha', () => {
    const ate = '2026-09-21T03:00:00Z';
    expect(estadoPorRelogio(ate, new Date('2026-09-21T02:59:59Z'))).toBe('editavel_hoje');
    expect(estadoPorRelogio(ate, new Date('2026-09-21T03:00:00Z'))).toBe('registrada');
  });

  it('o SQL usa America/Sao_Paulo', () => {
    expect(JANELA_SQL.editavelAte).toContain('America/Sao_Paulo');
    expect(JANELA_SQL.editavelHoje).toContain('America/Sao_Paulo');
  });
});

describe('janela fecha à meia-noite de Brasília (EVO-04)', () => {
  // Cadastro às 10:00 de 21/09 em Brasília: editável até 00:00 de 22/09 (03:00Z).
  const ATE = '2026-09-22T03:00:00Z';

  it('às 23:59:59 do dia do cadastro ainda é editável', () => {
    expect(estadoPorRelogio(ATE, new Date('2026-09-22T02:59:59.999Z'))).toBe('editavel_hoje');
  });

  it('à meia-noite e depois está registrada', () => {
    expect(estadoPorRelogio(ATE, new Date('2026-09-22T03:00:00.000Z'))).toBe('registrada');
    expect(estadoPorRelogio(ATE, new Date('2026-09-23T12:00:00Z'))).toBe('registrada');
  });
});
