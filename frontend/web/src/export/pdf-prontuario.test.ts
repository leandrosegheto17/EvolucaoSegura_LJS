import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Prontuario } from '@es/contrato/exportacao';
import {
  gerarPdfProntuario,
  montarDefinicaoProntuario,
  nomeArquivoProntuario,
} from './pdf-prontuario.ts';

// EXP-02: PDF do prontuário montado no navegador a partir do JSON de GET /api/pacientes/:id/prontuario.
const prontuario: Prontuario = {
  paciente: { id: '0a1b2c3d-4e5f-6789-abcd-ef0123456789', nome: 'José Conceição Ação' },
  periodo: { de: '2026-03-01', ate: '2026-03-31' },
  profissional: {
    nome: 'Dra. Ângela Müller',
    contato: 'angela@exemplo.com',
    endereco: 'Av. São João, 100',
    especialidade: 'psicologia',
    especialidade_nome: null,
    registro: 'CRP 06/12345',
  },
  anamnese: {
    id: 'an1',
    especialidade: 'psicologia',
    data_sessao: '2026-02-10',
    criado_em: '2026-02-10T13:00:00.000Z',
    dia: '2026-02-10',
    original: {
      modelo_revisao: 1,
      campos: [{ item_id: 'a', tipo: 'campo', rotulo: 'Queixa', texto: 'Ansiedade' }],
    },
    retificacoes: [
      {
        seq: 1,
        motivo: 'Correção de digitação',
        criado_em: '2026-02-12T13:00:00.000Z',
        dia: '2026-02-12',
        modelo_revisao: 1,
        campos: [
          { item_id: 'a', tipo: 'campo', rotulo: 'Queixa', texto: 'Ansiedade generalizada' },
        ],
      },
    ],
    versao_vigente: 1,
    vigente: {
      modelo_revisao: 1,
      campos: [
        { item_id: 'a', tipo: 'campo', rotulo: 'Queixa', texto: 'Ansiedade generalizada' },
        {
          item_id: 'b',
          tipo: 'alerta',
          rotulo: 'Medicação',
          marcado: true,
          obs: 'Usa ansiolítico',
        },
      ],
    },
  },
  evolucoes: [
    {
      id: 'e1',
      sessao_id: null,
      criado_em: '2026-03-05T13:00:00.000Z',
      dia: '2026-03-05',
      texto: 'Paciente relatou melhora na concentração.',
      versao_vigente: 0,
      texto_vigente: 'Paciente relatou melhora na concentração.',
      retificacoes: [],
    },
    {
      id: 'e2',
      sessao_id: null,
      criado_em: '2026-03-12T13:00:00.000Z',
      dia: '2026-03-12',
      texto: 'Texto original',
      versao_vigente: 1,
      texto_vigente: 'Texto retificado',
      retificacoes: [
        {
          seq: 1,
          texto: 'Texto retificado',
          motivo: 'Erro de fato',
          criado_em: '2026-03-13T13:00:00.000Z',
          dia: '2026-03-13',
        },
      ],
    },
  ],
};

const textos = (no: unknown, acc: string[] = []): string[] => {
  if (typeof no === 'string') acc.push(no);
  else if (Array.isArray(no)) no.forEach((n) => textos(n, acc));
  else if (no && typeof no === 'object') Object.values(no).forEach((n) => textos(n, acc));
  return acc;
};

describe('pdf-prontuario (EXP-02)', () => {
  it('nomeia o arquivo com os 8 primeiros caracteres do id', () => {
    expect(nomeArquivoProntuario(prontuario.paciente.id)).toBe('prontuario-0a1b2c3d.pdf');
  });

  it('traz título, paciente, período, registro profissional e rodapé', () => {
    const def = montarDefinicaoProntuario(prontuario) as Record<string, unknown>;
    const todo = textos(def.content).join('\n');
    expect(todo).toContain('Prontuário');
    expect(todo).toContain('Paciente: José Conceição Ação');
    expect(todo).toContain('Período: 01/03/2026 a 31/03/2026');
    expect(todo).toContain('Registro profissional: CRP 06/12345');
    const rodape = (def.footer as (p: number, n: number) => unknown)(2, 3);
    expect(textos(rodape).join('\n')).toContain('Prontuário — documento confidencial');
    expect(textos(rodape).join('\n')).toContain('Página 2 de 3');
    expect(textos((def.header as () => unknown)()).join('\n')).toContain('Dra. Ângela Müller');
  });

  it('mostra a versão vigente e o histórico das retificações', () => {
    const todo = textos(
      (montarDefinicaoProntuario(prontuario) as { content: unknown }).content,
    ).join('\n');
    expect(todo).toContain('Texto retificado');
    expect(todo).toContain('Histórico — original (12/03/2026)');
    expect(todo).toContain('Motivo: Erro de fato');
    expect(todo).toContain('Retificação 1 — 12/02/2026 — Motivo: Correção de digitação');
    expect(todo).toContain('Sim — Usa ansiolítico');
  });

  it('período em aberto e prontuário vazio', () => {
    const vazio: Prontuario = {
      ...prontuario,
      periodo: { de: null, ate: null },
      anamnese: null,
      evolucoes: [],
      profissional: null,
    };
    const todo = textos((montarDefinicaoProntuario(vazio) as { content: unknown }).content).join(
      '\n',
    );
    expect(todo).toContain('Período: prontuário completo');
    expect(todo).toContain('Sem anamnese registrada.');
    expect(todo).toContain('Nenhuma evolução no período.');
  });

  it('gera um PDF de verdade com fonte que cobre os acentos', async () => {
    const blob = await gerarPdfProntuario(prontuario);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    // Fonte TrueType embutida (Roboto do vfs do pdfmake, que tem Latin-1 completo).
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/Roboto/);
  });

  it('carrega o pdfmake só sob demanda (import dinâmico, fora do bundle principal)', () => {
    const fonte = readFileSync(resolve(import.meta.dirname, 'pdf-prontuario.ts'), 'utf8');
    expect(fonte).not.toMatch(/^import[^;]*from\s+['"]pdfmake/m);
    expect(fonte).toMatch(/import\(\s*['"]pdfmake\/build\/pdfmake['"]\s*\)/);
    expect(fonte).toMatch(/import\(\s*['"]pdfmake\/build\/vfs_fonts['"]\s*\)/);
  });
});
