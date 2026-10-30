import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// T220 / OPS-05, ISO-01: o `pnpm test:isolamento` (passo do CI) roda a suíte de isolamento de
// verdade e falha se ela não rodar. Antes, o script ia para backend/api (`pnpm --filter`), onde o
// binário do vitest é outra cópia do pacote (a do par do @cloudflare/vitest-plugin) e não a que
// os testes importam: a suíte caía com "failed to find the current suite", e o
// --passWithNoTests deixava passar zero testes.

const raiz = resolve(import.meta.dirname, '../../..');
const scripts = (pasta: string) =>
  (
    JSON.parse(readFileSync(resolve(raiz, pasta, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;
const passosDoCi = (
  parse(readFileSync(resolve(raiz, '.github/workflows/ci.yml'), 'utf8')) as {
    jobs: Record<string, { steps: { run?: string; 'working-directory'?: string }[] }>;
  }
).jobs;

describe('script test:isolamento (T220)', () => {
  const daRaiz = scripts('.')['test:isolamento']!;

  it('roda o vitest da raiz, no projeto da API, só a pasta do isolamento', () => {
    expect(daRaiz.split(/\s+/).slice(0, 2)).toEqual(['vitest', 'run']);
    expect(daRaiz).toContain('--project @es/api');
    expect(daRaiz).toMatch(/\sbackend\/api\/test\/isolamento(\s|$)/);
    expect(daRaiz).not.toContain('--filter');
  });

  it('zero testes é falha: liga --no-passWithNoTests e não aceita --passWithNoTests', () => {
    expect(daRaiz).toContain('--no-passWithNoTests');
    expect(daRaiz.replace('--no-passWithNoTests', '')).not.toContain('passWithNoTests');
  });

  it('de dentro de backend/api, o script do pacote chama o da raiz', () => {
    expect(scripts('backend/api')['test:isolamento']).toBe('pnpm -w test:isolamento');
  });

  it('o passo do CI chama o script na raiz do repositório', () => {
    const passos = Object.values(passosDoCi).flatMap((t) => t.steps);
    const passo = passos.find((p) => p.run?.trim() === 'pnpm test:isolamento');
    expect(passo).toBeDefined();
    expect(passo?.['working-directory']).toBeUndefined();
  });

  it('com as mesmas opções, uma pasta sem testes faz o vitest sair com erro', () => {
    const resultado = spawnSync(
      'npx',
      [
        'vitest',
        'run',
        '--project',
        '@es/api',
        '--no-passWithNoTests',
        'backend/api/test/pasta-sem-testes',
      ],
      { cwd: raiz, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000 },
    );
    expect(resultado.status).not.toBe(0);
    expect(`${resultado.stdout}${resultado.stderr}`).toMatch(/No test files found/i);
  }, 150_000);
});
