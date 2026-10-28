import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { pastaMigrations, urlComBanco } from './banco.ts';

// T199 / OPS-03: as migrations aplicam por uma role sem superusuário, como o neondb_owner do Neon
// (PG 18): LOGIN, CREATEDB e CREATEROLE, sem SUPERUSER nem BYPASSRLS, dona do banco. O Postgres
// local dos outros testes roda como superusuário e não pega o que só falha sem ele (achado da
// medição da exportação: SET app.* na definição de função, "permission denied to set parameter").
// - As roles evolucao_owner, evolucao_app e evolucao_backup_ro são do cluster e os outros testes já as criaram como
//   superusuário. No Neon quem as cria é o neondb_owner, na 0001, e o CREATE ROLE do PG 16 em
//   diante lhe dá ADMIN sem SET nem INHERIT. O teste reproduz esse vínculo antes de migrar.
// - Uma cópia das migrations com uma função que declara SET de parâmetro personalizado prova que
//   o teste falha nesse caso, com o erro do Neon.
// - Só dois bancos (um migrado por inteiro e um em que a transação é desfeita): cada DROP DATABASE
//   pede um checkpoint, e a suíte inteira já cria um banco por arquivo de teste.

const ROLES_DO_CLUSTER = ['evolucao_owner', 'evolucao_app', 'evolucao_backup_ro'];
const semLog = { info: () => {}, warn: () => {}, error: () => {} };
const sufixo = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const PAPEL = `es_sem_su_${sufixo}`;
const SENHA = `senha_${Math.floor(Math.random() * 1e9)}`;
const MIGRATION_COM_SET = `import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(\`
CREATE FUNCTION tarefas.com_set_personalizado() RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET app.tarefa_teste = 'on'
AS $$ SELECT 1 $$;
\`);
};
`;

const admin = new pg.Client({ connectionString: urlComBanco('postgres') });
const bancos: string[] = [];
let copia: string;

// URL do banco `banco` com o login da role sem superusuário.
const urlDoPapel = (banco: string): string => {
  const url = new URL(urlComBanco(banco));
  url.username = PAPEL;
  url.password = SENHA;
  return url.toString();
};

// Cria o banco pela própria role sem superusuário (dona dele, como o neondb no Neon).
async function bancoDoPapel(prefixo: string): Promise<string> {
  const nome = `es_${prefixo}_${sufixo}`;
  const cliente = new pg.Client({ connectionString: urlDoPapel('postgres') });
  await cliente.connect();
  try {
    await cliente.query(`create database ${nome}`);
  } finally {
    await cliente.end();
  }
  bancos.push(nome);
  return nome;
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(
    `create role ${PAPEL} login password '${SENHA}'
       nosuperuser createdb createrole nobypassrls`,
  );
  for (const role of ROLES_DO_CLUSTER) {
    // Mesmo tratamento da 0001: outro teste pode estar criando a role ao mesmo tempo.
    await admin.query(`
      do $$ begin
        if not exists (select from pg_roles where rolname = '${role}') then
          create role "${role}" nologin nosuperuser nocreatedb nocreaterole nobypassrls;
        end if;
      exception when duplicate_object or unique_violation then null;
      end $$`);
    await admin.query(`grant "${role}" to ${PAPEL} with admin true, inherit false, set false`);
  }
  copia = await mkdtemp(join(tmpdir(), 'es-migrations-'));
  await cp(pastaMigrations, copia, { recursive: true });
  await writeFile(join(copia, '9999_com_set_personalizado.ts'), MIGRATION_COM_SET);
}, 60_000);

afterAll(async () => {
  for (const nome of bancos) await admin.query(`drop database if exists ${nome} with (force)`);
  await admin.query(`drop role if exists ${PAPEL}`);
  await admin.end();
  if (copia) await rm(copia, { recursive: true, force: true });
}, 60_000);

const erroDe = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (erro) {
    const { code, message } = erro as { code?: string; message?: string };
    return { code, message };
  }
};

describe('migrations aplicadas por role sem superusuário (OPS-03)', () => {
  it('a role do teste não é superusuário nem ignora RLS', async () => {
    const { rows } = await admin.query(
      `select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
       from pg_roles where rolname = $1`,
      [PAPEL],
    );
    expect(rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: true,
        rolcreaterole: true,
        rolcanlogin: true,
      },
    ]);
  });

  it('aplica todas as migrations, da 0001 à última, numa transação', async () => {
    const arquivos = (await readdir(pastaMigrations))
      .filter((a) => a.endsWith('.ts'))
      .map((a) => a.replace(/\.ts$/, ''))
      .sort();
    const banco = await bancoDoPapel('sem_su');
    const aplicadas = await migrar({
      urlBanco: urlDoPapel(banco),
      pasta: pastaMigrations,
      logger: semLog,
    });
    expect(arquivos[0]).toMatch(/^0001_/);
    expect(aplicadas).toEqual(arquivos);
  }, 120_000);

  it('falha quando uma migration declara SET de parâmetro personalizado na definição de função', async () => {
    const banco = await bancoDoPapel('sem_su_set');
    const erro = await erroDe(() =>
      migrar({ urlBanco: urlDoPapel(banco), pasta: copia, logger: semLog }),
    );
    expect(erro).toMatchObject({
      code: '42501',
      message: expect.stringMatching(/permission denied to set parameter "app\.tarefa_teste"/),
    });
    // Tudo numa transação: nenhuma migration ficou registrada nem aplicada (a tabela pgmigrations
    // o node-pg-migrate cria antes da transação).
    const cliente = new pg.Client({ connectionString: urlDoPapel(banco) });
    await cliente.connect();
    try {
      const { rows } = await cliente.query(
        `select (select count(*)::integer from public.pgmigrations) as registradas,
                to_regnamespace('tarefas') as schema_tarefas`,
      );
      expect(rows).toEqual([{ registradas: 0, schema_tarefas: null }]);
    } finally {
      await cliente.end();
    }
  }, 120_000);
});
