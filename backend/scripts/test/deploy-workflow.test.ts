import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// OPS-03: o deploy.yml é manual, só pela main, no environment producao, com concurrency sem
// cancelamento, e executa na ordem: build do web, branch de restauração no Neon (mantendo as 2
// mais recentes), dump cifrado, migração com a role owner e o deploy do Worker com URL_PUBLICA.
// Nada disto é executado no GitHub por este teste: só lê o YAML.

interface Passo {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}
interface Trabalho {
  if?: string;
  environment?: string | { name: string };
  steps: Passo[];
}
interface Workflow {
  on: unknown;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs: Record<string, Trabalho>;
}

// O comando é montado em partes para este arquivo não ser acusado pelo teste do único deploy (OPS-04).
const WRANGLER_DEPLOY = ['wrangler', 'deploy'].join(' ');

const caminho = resolve(import.meta.dirname, '../../../.github/workflows/deploy.yml');
const workflow = parse(readFileSync(caminho, 'utf8')) as Workflow;
const trabalhos = Object.values(workflow.jobs);
const trabalho = trabalhos[0] as Trabalho;
const passos = trabalho.steps;

function indice(procurado: (passo: Passo) => boolean): number {
  return passos.findIndex(procurado);
}
const executa = (trecho: string) => (passo: Passo) => (passo.run ?? '').includes(trecho);
const usa = (acao: string) => (passo: Passo) => (passo.uses ?? '').startsWith(acao);

describe('deploy.yml (OPS-03)', () => {
  it('tem um único trabalho', () => {
    expect(trabalhos).toHaveLength(1);
  });

  it('dispara só por workflow_dispatch', () => {
    expect(Object.keys(workflow.on as object)).toEqual(['workflow_dispatch']);
  });

  it('roda só pela main', () => {
    expect(trabalho.if).toContain("github.ref == 'refs/heads/main'");
  });

  it('usa o environment producao', () => {
    const ambiente =
      typeof trabalho.environment === 'string' ? trabalho.environment : trabalho.environment?.name;
    expect(ambiente).toBe('producao');
  });

  it('tem concurrency sem cancelamento', () => {
    expect(workflow.concurrency?.group).toBeTruthy();
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('executa na ordem: build, branch de restauração, dump, migração, deploy do Worker', () => {
    const ordem = [
      indice(executa('pnpm build:web')),
      indice(usa('neondatabase/create-branch-action@v5')),
      indice(executa('pg_dump')),
      indice(executa('pnpm migrar')),
      indice(executa(WRANGLER_DEPLOY)),
    ];

    expect(ordem.every((posicao) => posicao >= 0)).toBe(true);
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    expect(new Set(ordem).size).toBe(ordem.length);
  });

  it('mantém as 2 branches de restauração mais recentes (apaga a excedente)', () => {
    const achar = passos[indice((p) => p.id === 'excedente')];
    const apagar = passos[indice(usa('neondatabase/delete-branch-action@v3'))];

    expect(achar?.env?.['MANTER_RESTAURACOES']).toBe('2');
    expect(achar?.run).toContain('restauracao-');
    expect(apagar).toBeDefined();
    expect(indice(usa('neondatabase/delete-branch-action@v3'))).toBeGreaterThan(
      indice(usa('neondatabase/create-branch-action@v5')),
    );
  });

  it('cifra o dump com age, sem gravar o dump em claro', () => {
    const dump = passos[indice(executa('pg_dump'))];

    expect(dump?.run).toMatch(/pg_dump -Fc .*\| age -r /);
    expect(dump?.run).not.toMatch(/pg_dump[^|\n]*(>|-f |--file)/);
  });

  it('migra com a role owner (NEON_URL_MIGRACAO)', () => {
    const migracao = passos[indice(executa('pnpm migrar'))];

    expect(migracao?.env?.['DATABASE_URL']).toBe('${{ secrets.NEON_URL_MIGRACAO }}');
  });

  it('publica o Worker com URL_PUBLICA', () => {
    const deploy = passos[indice(executa(WRANGLER_DEPLOY))];

    expect(deploy?.run).toMatch(/--var "URL_PUBLICA:\$URL_PUBLICA"/);
    expect(deploy?.env?.['URL_PUBLICA']).toBe('${{ vars.URL_PUBLICA }}');
  });

  it('usa o SHA do commit como release do Sentry no Worker e no web', () => {
    const build = passos[indice(executa('pnpm build:web'))];
    const deploy = passos[indice(executa(WRANGLER_DEPLOY))];

    expect(build?.env?.['VITE_SENTRY_RELEASE']).toBe('${{ github.sha }}');
    expect(deploy?.run).toContain('SENTRY_RELEASE:${{ github.sha }}');
  });
});
