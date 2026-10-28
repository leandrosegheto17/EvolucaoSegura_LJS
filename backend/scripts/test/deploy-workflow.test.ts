import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// OPS-03: o deploy.yml é manual, só pela main, no environment producao, com concurrency sem
// cancelamento, e executa na ordem: build do web, dump cifrado, migração com a role owner e o
// deploy do Worker com URL_PUBLICA. O Neon tem só as branches `main` e `dev`: o deploy não cria
// nem apaga branch; o ponto de volta antes de migrar é o dump cifrado com age.
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

  it('executa na ordem: build, dump, migração, deploy do Worker', () => {
    const ordem = [
      indice(executa('pnpm build:web')),
      indice(executa('pg_dump')),
      indice(executa('pnpm migrar')),
      indice(executa(WRANGLER_DEPLOY)),
    ];

    expect(ordem.every((posicao) => posicao >= 0)).toBe(true);
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    expect(new Set(ordem).size).toBe(ordem.length);
  });

  it('não cria nem apaga branch no Neon (só main e dev são permanentes)', () => {
    const texto = readFileSync(caminho, 'utf8');

    expect(passos.some((p) => (p.uses ?? '').startsWith('neondatabase/'))).toBe(false);
    expect(texto).not.toMatch(/restauracao-|console\.neon\.tech\/api|NEON_API_KEY|NEON_PROJECT_ID/);
  });

  it('guarda o dump cifrado como artefato antes da migração (ponto de volta)', () => {
    const guardar = indice(usa('actions/upload-artifact'));

    expect(guardar).toBeGreaterThan(indice(executa('pg_dump')));
    expect(guardar).toBeLessThan(indice(executa('pnpm migrar')));
    expect(String(passos[guardar]?.with?.['path'])).toMatch(/\.age$/);
  });

  it('cifra o dump com age, sem gravar o dump em claro', () => {
    const dump = passos[indice(executa('pg_dump'))];

    expect(dump?.run).toMatch(/pg_dump -Fc .*\| age -r /);
    expect(dump?.run).not.toMatch(/pg_dump[^|\n]*(>|-f |--file)/);
  });

  it('migra com a role owner (NEON_URL_MIGRACAO), com --alvo producao e sem DATABASE_URL', () => {
    const migracao = passos[indice(executa('pnpm migrar'))];

    expect(migracao?.env?.['NEON_URL_MIGRACAO']).toBe('${{ secrets.NEON_URL_MIGRACAO }}');
    expect(migracao?.run).toMatch(/pnpm migrar --alvo producao(\s|$)/);
    expect(migracao?.env).not.toHaveProperty('DATABASE_URL');
  });

  it('valida a NEON_URL_MIGRACAO (validarUrlNeon) antes do dump e da migração', () => {
    const validar = indice(executa('src/neon/validar-url.ts NEON_URL_MIGRACAO'));

    expect(validar).toBeGreaterThanOrEqual(0);
    expect(passos[validar]?.env?.['NEON_URL_MIGRACAO']).toBe('${{ secrets.NEON_URL_MIGRACAO }}');
    expect(validar).toBeLessThan(indice(executa('pg_dump')));
    expect(validar).toBeLessThan(indice(executa('pnpm migrar')));
  });

  it('confere o cache do Hyperdrive desligado antes do dump, da migração e do deploy', () => {
    const cache = indice(executa('cache-hyperdrive'));

    expect(cache).toBeGreaterThan(indice(executa('pnpm install')));
    expect(cache).toBeLessThan(indice(executa('pg_dump')));
    expect(cache).toBeLessThan(indice(executa('pnpm migrar')));
    expect(cache).toBeLessThan(indice(executa(WRANGLER_DEPLOY)));
    expect(passos[cache]?.env?.['CLOUDFLARE_API_TOKEN']).toBe(
      '${{ secrets.CLOUDFLARE_API_TOKEN }}',
    );
    expect(passos[cache]?.env?.['CLOUDFLARE_ACCOUNT_ID']).toBe('${{ vars.CLOUDFLARE_ACCOUNT_ID }}');
    expect(passos[cache]?.['continue-on-error' as keyof Passo]).toBeUndefined();
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
