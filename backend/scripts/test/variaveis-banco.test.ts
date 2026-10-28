import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Padrão Neon, item 3: conexão com o Neon só por variáveis NEON_URL_*; DATABASE_URL (e
// DATABASE_URL_TESTE) só para o Postgres local e os testes. O teste só lê os arquivos.

interface Passo {
  env?: Record<string, string>;
}
interface Trabalho {
  env?: Record<string, string>;
  steps?: Passo[];
}
interface Workflow {
  env?: Record<string, string>;
  jobs: Record<string, Trabalho>;
}

const raiz = resolve(import.meta.dirname, '../../..');
const pastaWorkflows = resolve(raiz, '.github/workflows');
const workflows = readdirSync(pastaWorkflows)
  .filter((nome) => /\.ya?ml$/.test(nome))
  .map((nome) => ({
    nome,
    yaml: parse(readFileSync(resolve(pastaWorkflows, nome), 'utf8')) as Workflow,
  }));

// Todas as atribuições de env (workflow, trabalho e passo) de um workflow.
function atribuicoes(workflow: Workflow): [string, string][] {
  const blocos = [
    workflow.env,
    ...Object.values(workflow.jobs).flatMap((trabalho) => [
      trabalho.env,
      ...(trabalho.steps ?? []).map((passo) => passo.env),
    ]),
  ];
  return blocos.flatMap((bloco) => Object.entries(bloco ?? {}));
}

describe('variáveis de conexão com o banco', () => {
  it('há workflows para conferir', () => {
    expect(workflows.map((w) => w.nome)).toEqual(
      expect.arrayContaining(['backup.yml', 'ci.yml', 'deploy.yml']),
    );
  });

  it.each(workflows.map((w) => [w.nome, w.yaml] as const))(
    '%s: todo secret NEON_URL_* vai para uma variável com o mesmo nome',
    (_nome, yaml) => {
      for (const [chave, valor] of atribuicoes(yaml)) {
        const secret = /secrets\.(NEON_URL_[A-Z0-9_]+)/.exec(String(valor));
        if (secret) expect(chave).toBe(secret[1]);
      }
    },
  );

  it.each(workflows.map((w) => [w.nome, w.yaml] as const))(
    '%s: DATABASE_URL e DATABASE_URL_TESTE só apontam para host local',
    (_nome, yaml) => {
      for (const [chave, valor] of atribuicoes(yaml)) {
        if (chave !== 'DATABASE_URL' && chave !== 'DATABASE_URL_TESTE') continue;
        expect(String(valor)).not.toMatch(/secrets\.|vars\.|neon/i);
        expect(new URL(String(valor)).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
      }
    },
  );

  it('o .env.example documenta toda URL do Neon como NEON_URL_* e DATABASE_URL como local', () => {
    const texto = readFileSync(resolve(raiz, '.env.example'), 'utf8');
    const documentacoes = texto
      .split(/\r?\n/)
      .filter((linha) => /^# [A-Z][A-Z0-9_]* \|/.test(linha));
    const doNeon = documentacoes.filter((linha) => /URL postgres:\/\/[^|]* do Neon/.test(linha));

    expect(doNeon.length).toBeGreaterThan(0);
    for (const linha of doNeon) expect(linha).toMatch(/^# NEON_URL_[A-Z0-9_]+ \|/);
    const local = documentacoes.find((linha) => linha.startsWith('# DATABASE_URL |'));
    expect(local).toMatch(/host local/);
  });
});
