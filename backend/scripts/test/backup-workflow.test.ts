import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// OPS-01: todo dia às 04:00 de Brasília (07:00 UTC), pg_dump -Fc pela role evolucao_backup_ro, cifrado com
// age e guardado como artefato por 30 dias; também manual. O teste só lê o YAML.

interface Passo {
  run?: string;
  shell?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Workflow {
  on: { schedule?: { cron: string }[]; workflow_dispatch?: unknown };
  jobs: Record<string, { steps: Passo[] }>;
}

const caminho = resolve(import.meta.dirname, '../../../.github/workflows/backup.yml');
const texto = readFileSync(caminho, 'utf8');
const workflow = parse(texto) as Workflow;
const passos = Object.values(workflow.jobs).flatMap((trabalho) => trabalho.steps);
const passoDoDump = passos.find((passo) => (passo.run ?? '').includes('pg_dump -Fc'));
const passoDoArtefato = passos.find((passo) =>
  (passo.uses ?? '').startsWith('actions/upload-artifact'),
);

describe('backup.yml (OPS-01)', () => {
  it('roda às 07:00 UTC, que são 04:00 em Brasília', () => {
    expect(workflow.on.schedule).toEqual([{ cron: '0 7 * * *' }]);
  });

  it('também pode ser disparado à mão', () => {
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  // T200: a asserção passou a exigir --enable-row-security (antes, 'pg_dump -Fc "$NEON_URL_BACKUP"').
  // A evolucao_backup_ro é NOBYPASSRLS: sem a opção o pg_dump falha nas tabelas com RLS.
  it('faz pg_dump -Fc --enable-row-security com a conexão da role evolucao_backup_ro (NEON_URL_BACKUP)', () => {
    expect(passoDoDump?.run).toContain('pg_dump -Fc --enable-row-security "$NEON_URL_BACKUP"');
    expect(passoDoDump?.env?.['NEON_URL_BACKUP']).toBe('${{ secrets.NEON_URL_BACKUP }}');
  });

  it('cifra o dump com age (chave pública em secret) sem gravá-lo em claro', () => {
    expect(passoDoDump?.run).toMatch(/pg_dump -Fc .*\| age -r "\$AGE_PUBLIC_KEY" -o \S+\.age/);
    expect(passoDoDump?.env?.['AGE_PUBLIC_KEY']).toBe('${{ secrets.AGE_PUBLIC_KEY }}');
  });

  it('guarda o artefato cifrado por 30 dias', () => {
    expect(passoDoArtefato?.with?.['retention-days']).toBe(30);
    expect(String(passoDoArtefato?.with?.['path'])).toMatch(/\.age$/);
  });

  it('usa conexão direta: o comando do dump não tem pooler e um passo recusa URL de pooler', () => {
    expect(passoDoDump?.run).not.toContain('-pooler');
    const guarda = passos.find((passo) => (passo.run ?? '').includes('*-pooler*'));
    expect(guarda?.run).toContain('exit 1');
  });

  it('valida a NEON_URL_BACKUP (validarUrlNeon) antes do dump', () => {
    const validar = passos.find((passo) =>
      (passo.run ?? '').includes('src/neon/validar-url.ts NEON_URL_BACKUP'),
    );

    expect(validar?.env?.['NEON_URL_BACKUP']).toBe('${{ secrets.NEON_URL_BACKUP }}');
    expect(passos.indexOf(validar as Passo)).toBeLessThan(passos.indexOf(passoDoDump as Passo));
    const checkout = passos.findIndex((passo) => (passo.uses ?? '').startsWith('actions/checkout'));
    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeLessThan(passos.indexOf(validar as Passo));
  });

  it('todo pg_dump do workflow usa --enable-row-security (T200)', () => {
    const dumps = passos.filter((passo) => /pg_dump\s+-/.test(passo.run ?? ''));
    expect(dumps).toHaveLength(1);
    for (const dump of dumps) expect(dump.run).toMatch(/pg_dump -Fc --enable-row-security /);
  });

  it('o artefato só é guardado depois do dump', () => {
    expect(passos.indexOf(passoDoArtefato as Passo)).toBeGreaterThan(
      passos.indexOf(passoDoDump as Passo),
    );
  });
});

// Bug dump-silencioso: o runner traz um pg_dump 16 no PATH, que recusa o servidor 18 do Neon, e o passo
// rodava `pg_dump | age` com o shell padrão do Actions (sem pipefail). O pg_dump falhava, o age ainda
// gravava um arquivo de 367 bytes e o passo ficava verde: backup vazio guardado como se fosse bom.
describe('backup.yml: o dump não pode falhar em silêncio', () => {
  it('usa o pg_dump 18 pelo caminho absoluto, não o do PATH', () => {
    expect(passoDoDump?.run).toContain('/usr/lib/postgresql/18/bin/pg_dump -Fc');
  });

  it('roda com shell bash, que liga o pipefail, para a falha do pg_dump derrubar o passo', () => {
    expect(passoDoDump?.shell).toBe('bash');
  });
});
