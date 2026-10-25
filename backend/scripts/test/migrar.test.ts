import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';

// OPS-05 / T28: o runner aplica as migrations do zero num banco vazio, reaplicar não altera nada
// e a falha de uma migration desfaz tudo. Usa fixtures de migration num diretório temporário e um
// banco criado e apagado por teste, no Postgres local (docker compose up -d) ou do CI.

const urlBase =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/evolucao_segura';
const semLog = { info: () => {}, warn: () => {}, error: () => {} };
const executar = promisify(execFile);

const urlComBanco = (banco: string): string => {
  const url = new URL(urlBase);
  url.pathname = `/${banco}`;
  return url.toString();
};

const admin = new pg.Client({ connectionString: urlComBanco('postgres') });
const bancosCriados: string[] = [];
const pastas: string[] = [];

async function criarBancoVazio(): Promise<string> {
  const nome = `es_migrar_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`create database ${nome}`);
  bancosCriados.push(nome);
  return urlComBanco(nome);
}

function criarPastaDeMigrations(arquivos: Record<string, string>): string {
  const pasta = mkdtempSync(join(tmpdir(), 'migrations-'));
  pastas.push(pasta);
  for (const [nome, conteudo] of Object.entries(arquivos))
    writeFileSync(join(pasta, nome), conteudo);
  return pasta;
}

async function consultar<T extends pg.QueryResultRow>(url: string, sql: string): Promise<T[]> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    return (await cliente.query<T>(sql)).rows;
  } finally {
    await cliente.end();
  }
}

const criaTabelaA = `
export const up = (pgm) => { pgm.sql('create table a (id int primary key)'); };
export const down = (pgm) => { pgm.sql('drop table a'); };
`;
const criaTabelaB = `
export const up = (pgm) => { pgm.sql('create table b (id int primary key, a_id int references a(id))'); };
export const down = (pgm) => { pgm.sql('drop table b'); };
`;
const migrationComErro = `
export const up = (pgm) => { pgm.sql('create table c (id int)'); pgm.sql('isto nao e sql valido'); };
export const down = () => {};
`;

beforeAll(async () => {
  await admin.connect();
}, 30_000);

afterAll(async () => {
  for (const banco of bancosCriados)
    await admin.query(`drop database if exists ${banco} with (force)`);
  await admin.end();
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true });
});

describe('migrar', () => {
  it('aplica do zero num banco vazio, uma migration por arquivo, na ordem', async () => {
    const url = await criarBancoVazio();
    const pasta = criarPastaDeMigrations({
      '0001_a.mjs': criaTabelaA,
      '0002_b.mjs': criaTabelaB,
    });

    const aplicadas = await migrar({ urlBanco: url, pasta, logger: semLog });

    expect(aplicadas).toEqual(['0001_a', '0002_b']);
    const tabelas = await consultar<{ table_name: string }>(
      url,
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('a', 'b') order by 1",
    );
    expect(tabelas.map((linha) => linha.table_name)).toEqual(['a', 'b']);
    const registradas = await consultar<{ name: string }>(
      url,
      'select name from pgmigrations order by id',
    );
    expect(registradas.map((linha) => linha.name)).toEqual(['0001_a', '0002_b']);
  });

  it('carrega migration escrita em TypeScript', async () => {
    const url = await criarBancoVazio();
    const pasta = criarPastaDeMigrations({
      '0001_a.ts': `
import type { MigrationBuilder } from 'node-pg-migrate';
export const up = (pgm: MigrationBuilder): void => { pgm.sql('create table a (id int primary key)'); };
export const down = (pgm: MigrationBuilder): void => { pgm.sql('drop table a'); };
`,
    });

    expect(await migrar({ urlBanco: url, pasta, logger: semLog })).toEqual(['0001_a']);
  });

  it('reaplicar não altera nada', async () => {
    const url = await criarBancoVazio();
    const pasta = criarPastaDeMigrations({ '0001_a.mjs': criaTabelaA, '0002_b.mjs': criaTabelaB });
    await migrar({ urlBanco: url, pasta, logger: semLog });
    await consultar(url, 'insert into a (id) values (1) returning id');
    const antes = await consultar(url, 'select id, name, run_on from pgmigrations order by id');

    const segunda = await migrar({ urlBanco: url, pasta, logger: semLog });

    expect(segunda).toEqual([]);
    expect(await consultar(url, 'select id, name, run_on from pgmigrations order by id')).toEqual(
      antes,
    );
    expect(await consultar(url, 'select id from a')).toEqual([{ id: 1 }]);
  });

  it('aplica só as migrations novas quando entra uma nova', async () => {
    const url = await criarBancoVazio();
    const pasta = criarPastaDeMigrations({ '0001_a.mjs': criaTabelaA });
    await migrar({ urlBanco: url, pasta, logger: semLog });
    writeFileSync(join(pasta, '0002_b.mjs'), criaTabelaB);

    expect(await migrar({ urlBanco: url, pasta, logger: semLog })).toEqual(['0002_b']);
  });

  it('a falha de uma migration desfaz tudo, inclusive as anteriores do mesmo lote', async () => {
    const url = await criarBancoVazio();
    const pasta = criarPastaDeMigrations({
      '0001_a.mjs': criaTabelaA,
      '0002_erro.mjs': migrationComErro,
    });

    await expect(migrar({ urlBanco: url, pasta, logger: semLog })).rejects.toThrow();

    const tabelas = await consultar<{ table_name: string }>(
      url,
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('a', 'c')",
    );
    expect(tabelas).toEqual([]);
    const registradas = await consultar<{ total: string }>(
      url,
      "select count(*)::text as total from information_schema.tables where table_name = 'pgmigrations'",
    ).then(async ([existe]) =>
      existe?.total === '0' ? [] : consultar(url, 'select name from pgmigrations'),
    );
    expect(registradas).toEqual([]);
  });
});

describe('pnpm migrar (linha de comando)', () => {
  it('roda sem erro no banco vazio usando DATABASE_URL e a pasta migrations real', async () => {
    const url = await criarBancoVazio();
    const raizDoPacote = resolve(import.meta.dirname, '..');
    mkdirSync(join(raizDoPacote, 'migrations'), { recursive: true });

    await executar(process.execPath, ['src/migrar.ts'], {
      cwd: raizDoPacote,
      env: { ...process.env, DATABASE_URL: url },
    });

    const tabela = await consultar<{ table_name: string }>(
      url,
      "select table_name from information_schema.tables where table_name = 'pgmigrations'",
    );
    expect(tabela).toEqual([{ table_name: 'pgmigrations' }]);
  }, 60_000);
});
