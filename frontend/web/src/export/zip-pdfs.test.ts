import type { Prontuario } from '@es/contrato/exportacao';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { gerarPdfsPacientes } from './zip-pdfs.ts';
import { montarZipCompleto } from './zip-completo.ts';

// EXP-02/EXP-03: o zip da exportação completa traz um PDF de prontuário por paciente.
const prontuario = (id: string, nome: string): Prontuario => ({
  paciente: { id, nome },
  periodo: { de: null, ate: null },
  profissional: null,
  anamnese: null,
  evolucoes: [],
});

describe('gerarPdfsPacientes', () => {
  it('gera um PDF por paciente com o nome do EXP-02 e entra no zip', async () => {
    const ids = ['0a1b2c3d-4e5f-6789-abcd-ef0123456789', '9f8e7d6c-5b4a-3210-fedc-ba9876543210'];
    const pedidos: string[] = [];
    const progresso: number[] = [];
    const pdfs = await gerarPdfsPacientes(
      ids.map((id) => ({ id })),
      async (id) => {
        pedidos.push(id);
        return prontuario(id, `Paciente ${id.slice(0, 2)}`);
      },
      (n) => progresso.push(n),
    );
    expect(pedidos).toEqual(ids);
    expect(progresso).toEqual([1, 2]);
    expect(Object.keys(pdfs)).toEqual([
      'prontuarios/prontuario-0a1b2c3d.pdf',
      'prontuarios/prontuario-9f8e7d6c.pdf',
    ]);

    const zip = unzipSync(await montarZipCompleto({} as never, pdfs));
    const nomes = Object.keys(zip).filter((n) => n.endsWith('.pdf'));
    expect(nomes).toHaveLength(2);
    for (const n of nomes) expect(strFromU8(zip[n]!.slice(0, 5))).toBe('%PDF-');
  }, 30_000);

  it('sem pacientes não gera PDF', async () => {
    expect(await gerarPdfsPacientes([], async () => prontuario('x', 'x'))).toEqual({});
  });
});
