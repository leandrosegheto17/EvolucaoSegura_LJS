import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T29 / ISO-03, ISO-04: migration 0001 cria as roles owner, app e backup_ro, o pgcrypto, o schema
// tarefas e o helper app_usuario_id(). A role app não ganha DELETE nem TRUNCATE por padrão, nem
// faz DDL; backup_ro só lê. Tabela "futura" = criada depois da migration, como fará cada etapa.

const SEM_PERMISSAO = '42501';
let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0001');
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

// Cria uma tabela como `criador` dentro de uma transação e roda `fn` antes de desfazer tudo.
async function comTabelaFutura<T>(criador: string | null, fn: () => Promise<T>): Promise<T> {
  await banco.cliente.query('begin');
  try {
    if (criador !== null) await banco.cliente.query(`set local role "${criador}"`);
    await banco.cliente.query('create table public.futura (id int primary key, texto text)');
    await banco.cliente.query("insert into public.futura values (1, 'a')");
    await banco.cliente.query('reset role');
    return await fn();
  } finally {
    await banco.cliente.query('rollback');
  }
}

async function erroComo(role: string, sql: string): Promise<string | null> {
  await banco.cliente.query('savepoint tentativa');
  await banco.cliente.query(`set local role "${role}"`);
  const codigo = await codigoDoErro(() => banco.cliente.query(sql));
  await banco.cliente.query('rollback to savepoint tentativa');
  await banco.cliente.query('reset role');
  return codigo;
}

describe('migration 0001: roles', () => {
  it('cria owner, app e backup_ro sem superusuário e sem BYPASSRLS', async () => {
    const roles = await consultar<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
    }>(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole from pg_roles
       where rolname in ('owner', 'app', 'backup_ro') order by rolname`,
    );

    expect(roles).toEqual([
      { rolname: 'app', rolsuper: false, rolbypassrls: false, rolcreaterole: false },
      { rolname: 'backup_ro', rolsuper: false, rolbypassrls: false, rolcreaterole: false },
      { rolname: 'owner', rolsuper: false, rolbypassrls: false, rolcreaterole: false },
    ]);
  });

  it.each([
    ['owner', 'owner'],
    ['o usuário que roda a migration', null],
  ])('app não tem DELETE nem TRUNCATE em tabela nova criada por %s', async (_rotulo, criador) => {
    await comTabelaFutura(criador, async () => {
      const [privilegios] = await consultar<{ delete: boolean; truncate: boolean }>(
        `select has_table_privilege('app', 'public.futura', 'DELETE') as delete,
                has_table_privilege('app', 'public.futura', 'TRUNCATE') as truncate`,
      );
      expect(privilegios).toEqual({ delete: false, truncate: false });
      expect(await erroComo('app', 'delete from public.futura')).toBe(SEM_PERMISSAO);
      expect(await erroComo('app', 'truncate public.futura')).toBe(SEM_PERMISSAO);
    });
  });

  it('app não faz DDL: não cria tabela em public nem em tarefas', async () => {
    await comoRole(banco.cliente, null, async () => {
      expect(await erroComo('app', 'create table public.x (id int)')).toBe(SEM_PERMISSAO);
      expect(await erroComo('app', 'create table tarefas.x (id int)')).toBe(SEM_PERMISSAO);
    });
  });

  it.each([
    ['owner', 'owner'],
    ['o usuário que roda a migration', null],
  ])('backup_ro lê tabela nova criada por %s, sem nenhuma escrita', async (_rotulo, criador) => {
    await comTabelaFutura(criador, async () => {
      const [privilegios] = await consultar<Record<string, boolean>>(
        `select has_table_privilege('backup_ro', 'public.futura', 'SELECT') as select,
                has_table_privilege('backup_ro', 'public.futura', 'INSERT') as insert,
                has_table_privilege('backup_ro', 'public.futura', 'UPDATE') as update,
                has_table_privilege('backup_ro', 'public.futura', 'DELETE') as delete,
                has_table_privilege('backup_ro', 'public.futura', 'TRUNCATE') as truncate`,
      );
      expect(privilegios).toEqual({
        select: true,
        insert: false,
        update: false,
        delete: false,
        truncate: false,
      });
      await banco.cliente.query('set local role backup_ro');
      expect(await consultar('select id, texto from public.futura')).toEqual([
        { id: 1, texto: 'a' },
      ]);
      await banco.cliente.query('reset role');
      expect(await erroComo('backup_ro', "insert into public.futura values (2, 'b')")).toBe(
        SEM_PERMISSAO,
      );
      expect(await erroComo('backup_ro', "update public.futura set texto = 'b'")).toBe(
        SEM_PERMISSAO,
      );
      expect(await erroComo('backup_ro', 'delete from public.futura')).toBe(SEM_PERMISSAO);
      expect(await erroComo('backup_ro', 'truncate public.futura')).toBe(SEM_PERMISSAO);
      expect(await erroComo('backup_ro', 'create table public.y (id int)')).toBe(SEM_PERMISSAO);
    });
  });
});

describe('migration 0001: base', () => {
  it('instala o pgcrypto e cria o schema tarefas com dono owner', async () => {
    expect(await consultar("select extname from pg_extension where extname = 'pgcrypto'")).toEqual([
      { extname: 'pgcrypto' },
    ]);
    expect(
      await consultar(
        `select n.nspname, r.rolname as dono from pg_namespace n
         join pg_roles r on r.oid = n.nspowner where n.nspname = 'tarefas'`,
      ),
    ).toEqual([{ nspname: 'tarefas', dono: 'owner' }]);
  });
});

describe('migration 0001: app_usuario_id()', () => {
  const usuario = '6f1c1d6e-2f5b-4a39-9a51-6f0f4b1c2d3e';

  it('devolve o valor de app.usuario_id definido na transação (vista pela role app)', async () => {
    const [linha] = await comoRole(
      banco.cliente,
      'app',
      () => consultar<{ id: string }>('select app_usuario_id() as id'),
      usuario,
    );
    expect(linha).toEqual({ id: usuario });
  });

  it('devolve null quando app.usuario_id não foi definido', async () => {
    const [linha] = await comoRole(banco.cliente, 'app', () =>
      consultar<{ id: string | null }>('select app_usuario_id() as id'),
    );
    expect(linha).toEqual({ id: null });
  });

  it('trata string vazia como ausente (o valor que sobra fora da transação)', async () => {
    const [linha] = await comoRole(
      banco.cliente,
      'app',
      () => consultar<{ id: string | null }>('select app_usuario_id() as id'),
      '',
    );
    expect(linha).toEqual({ id: null });
  });
});
