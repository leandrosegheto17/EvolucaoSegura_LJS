import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// OPS-05: em push ou PR, o ci.yml roda lint, typecheck, testes, gitleaks, build do web,
// migrations do zero num Postgres de serviço e o teste de isolamento.

interface Passo {
  name?: string;
  run?: string;
  uses?: string;
}
interface Trabalho {
  services?: Record<string, { image?: string }>;
  steps: Passo[];
}
interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, Trabalho>;
}

const caminho = new URL('../../../.github/workflows/ci.yml', import.meta.url);
const workflow = parse(readFileSync(caminho, 'utf8')) as Workflow;
const trabalhos = Object.values(workflow.jobs);
const passos = trabalhos.flatMap((t) => t.steps);
const comandos = passos.map((p) => p.run ?? '');

function indiceDoComando(trecho: string): number {
  return comandos.findIndex((c) => c.includes(trecho));
}

describe('ci.yml (OPS-05)', () => {
  it('dispara em push e em pull_request', () => {
    expect(Object.keys(workflow.on)).toEqual(expect.arrayContaining(['push', 'pull_request']));
  });

  it.each([
    ['lint', 'pnpm lint'],
    ['typecheck', 'pnpm typecheck'],
    ['testes', 'pnpm test'],
    ['gitleaks', 'gitleaks detect'],
    ['build do web', 'pnpm build:web'],
    ['migrations do zero', 'pnpm migrar'],
    ['teste de isolamento', 'pnpm test:isolamento'],
  ])('tem o passo de %s', (_nome, comando) => {
    expect(indiceDoComando(comando)).toBeGreaterThanOrEqual(0);
  });

  it('roda as migrations antes do teste de isolamento', () => {
    expect(indiceDoComando('pnpm migrar')).toBeLessThan(indiceDoComando('pnpm test:isolamento'));
  });

  it('usa um Postgres 18 como serviço (a versão do Neon)', () => {
    const imagens = trabalhos.flatMap((t) => Object.values(t.services ?? {}).map((s) => s.image));
    expect(imagens).toContain('postgres:18');
  });
});
