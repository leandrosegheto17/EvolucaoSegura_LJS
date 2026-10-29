import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// T208 / OPS-05: o e2e (Playwright) roda no CI num job próprio (workflow e2e.yml, em push e PR),
// fora do ci.yml e da trava local de testes. O job sobe o Postgres (o mesmo docker-compose do ambiente local), instala o Chromium e roda
// `pnpm e2e`; a chave do sandbox do Asaas vem do segredo do repositório. Sem a chave, os dois
// testes que dependem do sandbox são pulados de forma explícita (visível no relatório).

interface Passo {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}
interface Trabalho {
  'runs-on'?: string;
  env?: Record<string, string>;
  steps: Passo[];
}
interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, Trabalho>;
}

const raiz = new URL('../../../', import.meta.url);
const ler = (caminho: string) => readFileSync(new URL(caminho, raiz), 'utf8');
const workflow = parse(ler('.github/workflows/e2e.yml')) as Workflow;
const ci = parse(ler('.github/workflows/ci.yml')) as Workflow;
const e2e = workflow.jobs['e2e'];
const comandos = (t: Trabalho | undefined) => (t?.steps ?? []).map((p) => p.run ?? '');
const indice = (t: Trabalho | undefined, trecho: string) =>
  comandos(t).findIndex((c) => c.includes(trecho));

describe('e2e.yml: job e2e no CI (OPS-05, T208)', () => {
  it('existe um job e2e próprio, em push e pull_request', () => {
    expect(e2e).toBeDefined();
    expect(Object.keys(workflow.on)).toEqual(expect.arrayContaining(['push', 'pull_request']));
  });

  it('o e2e é o único job do e2e.yml e não roda no ci.yml (fica fora da suíte principal)', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['e2e']);
    const jobsDoCi = Object.values(ci.jobs);
    expect(jobsDoCi.length).toBeGreaterThan(0);
    for (const t of jobsDoCi) expect(indice(t, 'pnpm e2e')).toBe(-1);
  });

  it('instala as dependências travadas, o Chromium do Playwright e roda pnpm e2e por último', () => {
    const instalar = indice(e2e, 'pnpm install --frozen-lockfile');
    const chromium = indice(e2e, 'playwright install --with-deps chromium');
    const rodar = indice(e2e, 'pnpm e2e');
    expect(instalar).toBeGreaterThanOrEqual(0);
    expect(chromium).toBeGreaterThan(instalar);
    expect(rodar).toBeGreaterThan(chromium);
    expect(rodar).toBe(comandos(e2e).length - 1);
  });

  it('sobe o Postgres do docker-compose antes do e2e', () => {
    const postgres = indice(e2e, 'docker compose up -d --wait postgres');
    expect(postgres).toBeGreaterThanOrEqual(0);
    expect(postgres).toBeLessThan(indice(e2e, 'pnpm e2e'));
  });

  it('a chave do sandbox do Asaas vem do segredo do repositório, nunca escrita no arquivo', () => {
    const passo = e2e?.steps.find((p) => p.run?.includes('pnpm e2e'));
    const valor = passo?.env?.['ASAAS_API_KEY'] ?? e2e?.env?.['ASAAS_API_KEY'];
    expect(valor).toBe('${{ secrets.ASAAS_API_KEY }}');
  });
});

describe('specs do sandbox do Asaas sem a chave (T208)', () => {
  // Pulam de forma explícita, com o motivo no relatório, quando ASAAS_API_KEY não existe ou está
  // vazia (o Actions entrega '' quando o segredo não está cadastrado).
  const PULO = /test\.skip\(\s*!process\.env\['ASAAS_API_KEY'\],\s*'ASAAS_API_KEY ausente/;

  it('plano.spec.ts: o único teste pula sem a chave e não falha mais de propósito', () => {
    const texto = ler('e2e/plano.spec.ts');
    expect(texto).toMatch(PULO);
    expect(texto).not.toMatch(/expect\(process\.env\['ASAAS_API_KEY'\]/);
  });

  it('plano-webhook.spec.ts: só o teste que usa o sandbox pula; o do token errado sempre roda', () => {
    const texto = ler('e2e/plano-webhook.spec.ts');
    const [comSandbox, semToken] = texto.split("test('o webhook sem o token correto é recusado'");
    expect(comSandbox).toMatch(PULO);
    expect(semToken).toBeDefined();
    expect(semToken).not.toMatch(/test\.skip/);
    expect(texto).not.toMatch(/expect\(process\.env\['ASAAS_API_KEY'\]/);
  });
});

describe('testes.json: o e2e fica fora da trava local (T208)', () => {
  it('o comando da trava não roda o e2e e o registro diz onde ele roda', () => {
    const config = JSON.parse(ler('.specs/projeto/testes.json')) as Record<string, string>;
    expect(config['comando']).not.toContain('e2e');
    expect(config['e2e']).toMatch(/fora da trava/);
    expect(config['e2e']).toMatch(/e2e\.yml/);
  });
});
