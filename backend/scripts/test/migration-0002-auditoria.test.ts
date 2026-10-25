import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T30 / AUD-01, ISO-01, ISO-03, ISO-04: audit_log é só de inclusão (UPDATE, DELETE e TRUNCATE
// barrados por trigger, inclusive para owner e superusuário), tem RLS forçada e cada profissional
// só enxerga as próprias linhas. backup_ro lê todas para o pg_dump.

const SO_INCLUSAO = 'ES001';
const VIOLA_RLS_OU_SEM_PERMISSAO = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0002');
  // Superusuário ignora RLS: semeia uma linha de cada profissional.
  await banco.cliente.query(
    `insert into audit_log (usuario_id, ator, acao, alvo_tipo) values
     ($1::text::uuid, $1::text, 'auth.login_ok', 'conta'), ($2::text::uuid, $2::text, 'auth.login_ok', 'conta')`,
    [A, B],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

const usuariosVisiveis = async (): Promise<string[]> =>
  (await consultar<{ usuario_id: string }>('select usuario_id from audit_log order by 1')).map(
    (linha) => linha.usuario_id,
  );

describe('audit_log: só inclusão', () => {
  it.each([
    ['owner', 'owner'],
    ['superusuário (quem roda a migration localmente)', null],
  ])('UPDATE é barrado pelo trigger para %s', async (_rotulo, role) => {
    const codigo = await comoRole(
      banco.cliente,
      role,
      () => codigoDoErro(() => banco.cliente.query("update audit_log set acao = 'auth.logout'")),
      A,
    );
    expect(codigo).toBe(SO_INCLUSAO);
  });

  it.each([
    ['owner', 'owner'],
    ['superusuário (quem roda a migration localmente)', null],
  ])('DELETE é barrado pelo trigger para %s', async (_rotulo, role) => {
    const codigo = await comoRole(
      banco.cliente,
      role,
      () => codigoDoErro(() => banco.cliente.query('delete from audit_log')),
      A,
    );
    expect(codigo).toBe(SO_INCLUSAO);
  });

  it('TRUNCATE é barrado pelo trigger mesmo para owner', async () => {
    const codigo = await comoRole(banco.cliente, 'owner', () =>
      codigoDoErro(() => banco.cliente.query('truncate audit_log')),
    );
    expect(codigo).toBe(SO_INCLUSAO);
  });

  it('as linhas continuam lá depois das tentativas', async () => {
    expect(await usuariosVisiveis()).toEqual([A, B]);
  });

  it('app tem só SELECT e INSERT: sem UPDATE, DELETE nem TRUNCATE', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('app', 'audit_log', 'SELECT') as select,
              has_table_privilege('app', 'audit_log', 'INSERT') as insert,
              has_table_privilege('app', 'audit_log', 'UPDATE') as update,
              has_table_privilege('app', 'audit_log', 'DELETE') as delete,
              has_table_privilege('app', 'audit_log', 'TRUNCATE') as truncate`,
    );
    expect(privilegios).toEqual({
      select: true,
      insert: true,
      update: false,
      delete: false,
      truncate: false,
    });
  });
});

describe('audit_log: RLS forçada e isolamento', () => {
  it('tem RLS ativa e FORCE', async () => {
    expect(
      await consultar(
        "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.audit_log'::regclass",
      ),
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it('o profissional só enxerga as próprias linhas', async () => {
    expect(await comoRole(banco.cliente, 'app', usuariosVisiveis, A)).toEqual([A]);
    expect(await comoRole(banco.cliente, 'app', usuariosVisiveis, B)).toEqual([B]);
  });

  it('sem usuário na transação, nenhuma linha fica visível (nem para owner)', async () => {
    expect(await comoRole(banco.cliente, 'app', usuariosVisiveis)).toEqual([]);
    expect(await comoRole(banco.cliente, 'owner', usuariosVisiveis)).toEqual([]);
  });

  it('o profissional grava evento próprio e não grava em nome de outro', async () => {
    const proprio = await comoRole(
      banco.cliente,
      'app',
      async () => {
        await banco.cliente.query(
          "insert into audit_log (usuario_id, ator, acao, alvo_tipo) values ($1::text::uuid, $1::text, 'auth.logout', 'conta')",
          [A],
        );
        return usuariosVisiveis();
      },
      A,
    );
    expect(proprio).toEqual([A, A]);

    const deOutro = await comoRole(
      banco.cliente,
      'app',
      () =>
        codigoDoErro(() =>
          banco.cliente.query(
            "insert into audit_log (usuario_id, ator, acao, alvo_tipo) values ($1::text::uuid, $1::text, 'auth.logout', 'conta')",
            [B],
          ),
        ),
      A,
    );
    expect(deOutro).toBe(VIOLA_RLS_OU_SEM_PERMISSAO);
  });

  it('backup_ro lê todas as linhas, sem usuário na transação', async () => {
    expect(await comoRole(banco.cliente, 'backup_ro', usuariosVisiveis)).toEqual([A, B]);
  });
});
