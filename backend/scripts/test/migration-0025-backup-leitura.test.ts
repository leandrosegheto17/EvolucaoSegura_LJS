import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { sqlConferirLeituraDoBackup } from '../migrations/0025_backup_leitura.ts';
import { migrar } from '../src/migrar.ts';
import { codigoDoErro, comoRole, pastaMigrations, urlComBanco } from './banco.ts';

// T200 / OPS-01, OPS-02: o pg_dump pela evolucao_backup_ro lê tudo. A 0025 concede SELECT em
// pgmigrations e nas sequences (e o privilégio padrão das sequences futuras); o dump usa
// --enable-row-security para as tabelas com RLS, que a evolucao_backup_ro lê por policy própria.
//
// O banco é migrado como no Neon: por uma role sem superusuário (LOGIN, CREATEDB, CREATEROLE,
// sem BYPASSRLS), dona do banco, com vínculo às roles do cluster sem INHERIT nem SET (o mesmo da
// T199). Assim um GRANT que só funciona como superusuário não passa aqui. O pg_dump roda pela
// conexão de superusuário com --role=evolucao_backup_ro (SET ROLE logo ao conectar): privilégios e
// RLS valem para a evolucao_backup_ro, sem dar LOGIN a uma role do cluster.
// O pg_dump precisa ser da versão maior do servidor ou mais nova: PG_BIN aponta a pasta dele
// (no CI, o cliente 18); sem PG_BIN, usa o do PATH.

const ROLES_DO_CLUSTER = ['evolucao_owner', 'evolucao_app', 'evolucao_backup_ro'];
const semLog = { info: () => {}, warn: () => {}, error: () => {} };
const sufixo = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const PAPEL = `es_t200_${sufixo}`;
const SENHA = `senha_${Math.floor(Math.random() * 1e9)}`;
const NOME_BANCO = `es_m0025_${sufixo}`;
const USUARIO = '33333333-3333-4333-8333-333333333333';
const MARCA_USUARIO = `marca-usuario-${sufixo}`;
const MARCA_AUDITORIA = 'marca_teste.leitura_backup';
const MARCA_NOTIFICACAO = `marca-notificacao-${sufixo}`;

const binario = (nome: string): string =>
  process.env['PG_BIN'] ? join(process.env['PG_BIN'], nome) : nome;

const admin = new pg.Client({ connectionString: urlComBanco('postgres') });
let cliente: pg.Client;
let dump: Buffer;

const urlDoPapel = (banco: string): string => {
  const url = new URL(urlComBanco(banco));
  url.username = PAPEL;
  url.password = SENHA;
  return url.toString();
};

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await cliente.query(sql, parametros)).rows as T[];

function pgDump(argumentos: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(binario('pg_dump'), [...argumentos, `--dbname=${urlComBanco(NOME_BANCO)}`], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

function pgRestore(argumentos: string[]): string {
  const resultado = spawnSync(binario('pg_restore'), argumentos, {
    input: dump,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (resultado.status !== 0) throw new Error(String(resultado.stderr));
  return String(resultado.stdout);
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(
    `create role ${PAPEL} login password '${SENHA}'
       nosuperuser createdb createrole nobypassrls`,
  );
  for (const role of ROLES_DO_CLUSTER) {
    await admin.query(`
      do $$ begin
        if not exists (select from pg_roles where rolname = '${role}') then
          create role "${role}" nologin nosuperuser nocreatedb nocreaterole nobypassrls;
        end if;
      exception when duplicate_object or unique_violation then null;
      end $$`);
    await admin.query(`grant "${role}" to ${PAPEL} with admin true, inherit false, set false`);
  }
  const doPapel = new pg.Client({ connectionString: urlDoPapel('postgres') });
  await doPapel.connect();
  try {
    await doPapel.query(`create database ${NOME_BANCO}`);
  } finally {
    await doPapel.end();
  }
  await migrar({ urlBanco: urlDoPapel(NOME_BANCO), pasta: pastaMigrations, logger: semLog });

  cliente = new pg.Client({ connectionString: urlComBanco(NOME_BANCO) });
  await cliente.connect();
  // Uma linha no usuario (sem RLS) e duas em tabelas com RLS forçada; o superusuário grava por
  // cima do RLS.
  await cliente.query(`insert into public.usuario (id, email, nome) values ($1, $2, $3)`, [
    USUARIO,
    'backup-t200@exemplo.com.br',
    MARCA_USUARIO,
  ]);
  await cliente.query(
    `insert into public.audit_log (usuario_id, ator, acao, alvo_tipo) values ($1, 'sistema', $2, 'usuario')`,
    [USUARIO, MARCA_AUDITORIA],
  );
  await cliente.query(
    `insert into public.notificacao_enviada (usuario_id, tipo, ref) values ($1, 'sessao_proxima', $2)`,
    [USUARIO, MARCA_NOTIFICACAO],
  );

  const resultado = pgDump(['-Fc', '--enable-row-security', '--role=evolucao_backup_ro']);
  if (resultado.status !== 0) throw new Error(`pg_dump falhou: ${String(resultado.stderr)}`);
  dump = resultado.stdout as Buffer;
}, 180_000);

afterAll(async () => {
  await cliente?.end();
  await admin.query(`drop database if exists ${NOME_BANCO} with (force)`);
  await admin.query(`drop role if exists ${PAPEL}`);
  await admin.end();
}, 60_000);

describe('migration 0025: o backup lê tudo (OPS-01, OPS-02)', () => {
  it('concede SELECT em pgmigrations à evolucao_backup_ro', async () => {
    const [linha] = await consultar<{ pode: boolean }>(
      `select has_table_privilege('evolucao_backup_ro', 'public.pgmigrations', 'SELECT') as pode`,
    );
    expect(linha?.pode).toBe(true);
  });

  it('concede SELECT em todas as sequences, de quem migra e do owner', async () => {
    const sequences = await consultar<{ nome: string; dono: string; pode: boolean }>(
      `select format('%I.%I', n.nspname, c.relname) as nome, pg_get_userbyid(c.relowner) as dono,
              has_sequence_privilege('evolucao_backup_ro', c.oid, 'SELECT') as pode
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'S' and n.nspname not in ('pg_catalog', 'information_schema')
       order by 1`,
    );
    const nomes = sequences.map((s) => s.nome);
    expect(nomes).toEqual(
      expect.arrayContaining(['public.pgmigrations_id_seq', 'public.audit_log_id_seq']),
    );
    expect(new Set(sequences.map((s) => s.dono))).toEqual(new Set([PAPEL, 'evolucao_owner']));
    expect(sequences.filter((s) => !s.pode)).toEqual([]);
  });

  it('nas sequences é só SELECT: sem USAGE nem UPDATE (não avança sequence)', async () => {
    const comMais = await consultar<{ nome: string }>(
      `select c.relname as nome from pg_class c
       where c.relkind = 'S'
         and (has_sequence_privilege('evolucao_backup_ro', c.oid, 'USAGE')
              or has_sequence_privilege('evolucao_backup_ro', c.oid, 'UPDATE'))`,
    );
    expect(comMais).toEqual([]);
  });

  it('sequence futura do owner já nasce legível pela evolucao_backup_ro', async () => {
    const pode = await comoRole(cliente, 'evolucao_owner', async () => {
      await cliente.query('create sequence public.seq_futura_owner');
      const { rows } = await cliente.query(
        `select has_sequence_privilege('evolucao_backup_ro', 'public.seq_futura_owner', 'SELECT') as pode`,
      );
      return (rows[0] as { pode: boolean }).pode;
    });
    expect(pode).toBe(true);
  });

  it('sequence futura de quem migra já nasce legível pela evolucao_backup_ro', async () => {
    const doPapel = new pg.Client({ connectionString: urlDoPapel(NOME_BANCO) });
    await doPapel.connect();
    try {
      const pode = await comoRole(doPapel, null, async () => {
        await doPapel.query('create sequence public.seq_futura_migracao');
        const { rows } = await doPapel.query(
          `select has_sequence_privilege('evolucao_backup_ro', 'public.seq_futura_migracao', 'SELECT') as pode`,
        );
        return (rows[0] as { pode: boolean }).pode;
      });
      expect(pode).toBe(true);
    } finally {
      await doPapel.end();
    }
  });

  it('a conferência da migration falha se uma sequence ficar sem SELECT', async () => {
    // Criada pelo superusuário, que neste banco não tem privilégio padrão para a evolucao_backup_ro.
    const erro = await comoRole(cliente, null, async () => {
      await cliente.query('create sequence public.seq_sem_leitura');
      return codigoDoErro(() => cliente.query(sqlConferirLeituraDoBackup('evolucao_backup_ro')));
    });
    expect(erro).toBe('P0001');
    await expect(
      cliente.query(sqlConferirLeituraDoBackup('evolucao_backup_ro')),
    ).resolves.toBeDefined();
  });

  it('a conferência falha se a pgmigrations ficar sem SELECT', async () => {
    const erro = await comoRole(cliente, null, async () => {
      await cliente.query('revoke select on public.pgmigrations from evolucao_backup_ro');
      return codigoDoErro(() => cliente.query(sqlConferirLeituraDoBackup('evolucao_backup_ro')));
    });
    expect(erro).toBe('P0001');
  });
});

describe('pg_dump -Fc --enable-row-security como evolucao_backup_ro (OPS-01)', () => {
  it('o dump traz as linhas das tabelas com RLS (e das sem RLS)', () => {
    const auditoria = pgRestore(['--data-only', '--table=audit_log', '-f', '-']);
    const notificacao = pgRestore(['--data-only', '--table=notificacao_enviada', '-f', '-']);
    const usuario = pgRestore(['--data-only', '--table=usuario', '-f', '-']);
    expect(auditoria).toContain(MARCA_AUDITORIA);
    expect(notificacao).toContain(MARCA_NOTIFICACAO);
    expect(usuario).toContain(MARCA_USUARIO);
  });

  it('o dump traz a pgmigrations com as migrations aplicadas e o valor das sequences', () => {
    const migracoes = pgRestore(['--data-only', '--table=pgmigrations', '-f', '-']);
    const indice = pgRestore(['-l']);
    expect(migracoes).toContain('0025_backup_leitura');
    expect(indice).toMatch(/SEQUENCE SET public audit_log_id_seq/);
    expect(indice).toMatch(/SEQUENCE SET public pgmigrations_id_seq/);
  });

  it('toda tabela com RLS tem policy de leitura total para a evolucao_backup_ro', async () => {
    const tabelas = await consultar<{ tabela: string; le_tudo: boolean }>(
      `select c.relname as tabela,
              exists (
                select 1 from pg_policy p
                where p.polrelid = c.oid and p.polcmd in ('r', '*') and p.polpermissive
                  and 'evolucao_backup_ro'::regrole = any (p.polroles)
                  and pg_get_expr(p.polqual, p.polrelid) = 'true'
              ) as le_tudo
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and c.relrowsecurity and n.nspname = 'public'
       order by 1`,
    );
    expect(tabelas.length).toBeGreaterThan(0);
    expect(tabelas.map((t) => t.tabela)).toEqual(
      expect.arrayContaining(['audit_log', 'notificacao_enviada']),
    );
    expect(tabelas.filter((t) => !t.le_tudo)).toEqual([]);
  });

  it('sem --enable-row-security o mesmo dump falha nas tabelas com RLS', () => {
    const resultado = pgDump(['-Fc', '--role=evolucao_backup_ro']);
    expect(resultado.status).not.toBe(0);
    expect(String(resultado.stderr)).toMatch(/row-level security/);
  });
});

describe('a evolucao_backup_ro só lê e a evolucao_owner não faz login', () => {
  it('a evolucao_backup_ro não tem INSERT, UPDATE, DELETE nem TRUNCATE em tabela nenhuma', async () => {
    const comEscrita = await consultar<{ tabela: string }>(
      `select format('%I.%I', n.nspname, c.relname) as tabela
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p', 'v', 'm', 'f')
         and n.nspname not in ('pg_catalog', 'information_schema')
         and (has_table_privilege('evolucao_backup_ro', c.oid, 'INSERT')
              or has_table_privilege('evolucao_backup_ro', c.oid, 'UPDATE')
              or has_table_privilege('evolucao_backup_ro', c.oid, 'DELETE')
              or has_table_privilege('evolucao_backup_ro', c.oid, 'TRUNCATE')
              or has_any_column_privilege('evolucao_backup_ro', c.oid, 'INSERT')
              or has_any_column_privilege('evolucao_backup_ro', c.oid, 'UPDATE'))`,
    );
    expect(comEscrita).toEqual([]);
  });

  it.each([
    ['INSERT', `insert into public.pgmigrations (name, run_on) values ('x', now())`],
    ['UPDATE', `update public.usuario set nome = 'x'`],
    ['DELETE', 'delete from public.audit_log'],
  ])('%s como evolucao_backup_ro é recusado (42501)', async (_comando, sql) => {
    const erro = await comoRole(cliente, 'evolucao_backup_ro', () =>
      codigoDoErro(() => cliente.query(sql)),
    );
    expect(erro).toBe('42501');
  });

  it('evolucao_owner é NOLOGIN e evolucao_backup_ro é NOSUPERUSER e NOBYPASSRLS', async () => {
    const roles = await consultar<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles
       where rolname in ('evolucao_owner', 'evolucao_backup_ro') order by 1`,
    );
    expect(roles).toEqual([
      { rolname: 'evolucao_backup_ro', rolcanlogin: false, rolsuper: false, rolbypassrls: false },
      { rolname: 'evolucao_owner', rolcanlogin: false, rolsuper: false, rolbypassrls: false },
    ]);
  });
});

describe('CI do teste da migration 0025', () => {
  interface Passo {
    run?: string;
    env?: Record<string, string>;
  }
  interface Workflow {
    jobs: Record<string, { env?: Record<string, string>; steps: Passo[] }>;
  }
  const ler = (arquivo: string): Workflow =>
    parse(
      readFileSync(resolve(import.meta.dirname, '../../../.github/workflows', arquivo), 'utf8'),
    ) as Workflow;

  it('o CI instala o cliente 18 do Postgres e aponta PG_BIN para ele (pg_dump deste teste)', () => {
    const trabalhos = Object.values(ler('ci.yml').jobs);
    const passos = trabalhos.flatMap((t) => t.steps);
    expect(passos.some((p) => (p.run ?? '').includes('postgresql-client-18'))).toBe(true);
    expect(trabalhos.map((t) => t.env?.['PG_BIN'])).toEqual(['/usr/lib/postgresql/18/bin']);
  });
});
