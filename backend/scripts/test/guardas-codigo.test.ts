import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  arquivosComImportacaoProibida,
  arquivosComUrlDoApp,
  dependenciasProibidas,
  temUrlAbsolutaDoApp,
} from '../src/guardas.ts';

// OPS-10: nenhuma URL absoluta do app no código nem nas migrations; a única fonte é URL_PUBLICA.
// OPS-14: o Worker não calcula hash de senha nem gera PDF (sem essas bibliotecas em backend/api).

const raizDoRepositorio = resolve(import.meta.dirname, '../../..');
const temporarios: string[] = [];

function arvoreDeExemplo(arquivos: Record<string, string>): string {
  const raiz = mkdtempSync(join(tmpdir(), 'guardas-'));
  temporarios.push(raiz);
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(join(raiz, caminho, '..'), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }
  return raiz;
}

afterAll(() => {
  for (const pasta of temporarios) rmSync(pasta, { recursive: true, force: true });
});

describe('guarda da URL do app (OPS-10)', () => {
  it('reconhece o domínio literal do app com protocolo', () => {
    expect(temUrlAbsolutaDoApp("const url = 'https://evolucaosegura.com.br/app';")).toBe(true);
    expect(temUrlAbsolutaDoApp('http://app.evolucaosegura.com.br')).toBe(true);
  });

  it('não acusa endereço de e-mail do domínio', () => {
    expect(temUrlAbsolutaDoApp('contato@evolucaosegura.com.br')).toBe(false);
  });

  it('falha ao inserir o domínio literal em código e em migration (árvore de exemplo)', () => {
    const raiz = arvoreDeExemplo({
      'api/src/rota.ts': "export const link = 'https://evolucaosegura.com.br/confirmar';",
      'scripts/migrations/0001.sql': "insert into x values ('https://app.evolucaosegura.com.br');",
      'web/src/limpo.tsx': 'export const ok = 1;',
    });

    expect(arquivosComUrlDoApp(raiz).sort()).toEqual([
      'api/src/rota.ts',
      'scripts/migrations/0001.sql',
    ]);
  });

  it('ignora testes e dependências ao varrer', () => {
    const raiz = arvoreDeExemplo({
      'api/test/exemplo.ts': "const u = 'https://evolucaosegura.com.br';",
      'api/src/rota.test.ts': "const u = 'https://evolucaosegura.com.br';",
      'api/node_modules/x/index.js': "const u = 'https://evolucaosegura.com.br';",
    });

    expect(arquivosComUrlDoApp(raiz)).toEqual([]);
  });

  it.each(['backend', 'frontend'])('%s/ não tem URL absoluta do app', (pasta) => {
    expect(arquivosComUrlDoApp(join(raizDoRepositorio, pasta))).toEqual([]);
  });
});

describe('guarda de bibliotecas proibidas na API (OPS-14)', () => {
  it.each(['bcrypt', 'pdfmake'])('falha ao adicionar %s ao package.json', (biblioteca) => {
    expect(dependenciasProibidas({ dependencies: { [biblioteca]: '1.0.0' } })).toEqual([
      biblioteca,
    ]);
    expect(dependenciasProibidas({ devDependencies: { [biblioteca]: '1.0.0' } })).toEqual([
      biblioteca,
    ]);
  });

  it('falha ao importar biblioteca proibida no código da API (árvore de exemplo)', () => {
    const raiz = arvoreDeExemplo({
      'src/senha.ts': "import bcrypt from 'bcrypt';",
      'src/pdf.ts': "const pdfmake = require('pdfmake/build/pdfmake');",
      'src/limpo.ts': "import { Hono } from 'hono';",
    });

    expect(arquivosComImportacaoProibida(raiz).sort()).toEqual(['src/pdf.ts', 'src/senha.ts']);
  });

  it('o package.json e o código de backend/api estão limpos', () => {
    const pacote = JSON.parse(
      readFileSync(join(raizDoRepositorio, 'backend/api/package.json'), 'utf8'),
    ) as Parameters<typeof dependenciasProibidas>[0];

    expect(dependenciasProibidas(pacote)).toEqual([]);
    expect(arquivosComImportacaoProibida(join(raizDoRepositorio, 'backend/api'))).toEqual([]);
  });
});
