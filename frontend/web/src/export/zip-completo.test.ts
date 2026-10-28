import { TABELAS_EXPORTACAO, type PaginaExportacao } from '@es/contrato/exportacao';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { juntarPaginas, montarZipCompleto } from './zip-completo.ts';

// EXP-03: o app junta as páginas da exportação e monta o .zip com dados.json.
const pag = (
  tabela: PaginaExportacao['tabela'],
  ids: string[],
  proximo: string | null,
): PaginaExportacao => ({
  tabela,
  linhas: ids.map((id) => ({ id })),
  proximo_cursor: proximo,
});

describe('juntarPaginas', () => {
  it('junta as páginas na ordem, sem perder linha, e devolve todas as tabelas', async () => {
    const respostas: Record<string, PaginaExportacao> = {
      inicio: pag('perfil', ['p1'], 'c1'),
      c1: pag('paciente', ['a', 'b'], 'c2'),
      c2: pag('paciente', ['c'], 'c3'),
      c3: pag('configuracao_usuario', ['z'], null),
    };
    const cursores: (string | null)[] = [];
    const progresso: number[] = [];
    const dados = await juntarPaginas(
      async (cursor) => {
        cursores.push(cursor);
        return respostas[cursor ?? 'inicio']!;
      },
      (n) => progresso.push(n),
    );
    expect(cursores).toEqual([null, 'c1', 'c2', 'c3']);
    expect(dados.paciente).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(dados.perfil).toEqual([{ id: 'p1' }]);
    expect(dados.configuracao_usuario).toEqual([{ id: 'z' }]);
    expect(Object.keys(dados)).toEqual([...TABELAS_EXPORTACAO]);
    expect(dados.evolucao).toEqual([]);
    expect(progresso).toEqual([1, 2, 3, 4]);
  });
});

describe('montarZipCompleto', () => {
  it('põe dados.json com todas as tabelas e os arquivos extras no zip', async () => {
    const dados = await juntarPaginas(async () => pag('perfil', ['p1'], null));
    const zip = await montarZipCompleto(dados, { 'prontuarios/x.pdf': new Uint8Array([1, 2, 3]) });
    const arquivos = unzipSync(zip);
    expect(Object.keys(arquivos).sort()).toEqual(['dados.json', 'prontuarios/x.pdf']);
    const json = JSON.parse(strFromU8(arquivos['dados.json']!)) as Record<string, unknown[]>;
    expect(Object.keys(json)).toEqual([...TABELAS_EXPORTACAO]);
    expect(json.perfil).toEqual([{ id: 'p1' }]);
    expect([...arquivos['prontuarios/x.pdf']!]).toEqual([1, 2, 3]);
  });
});
