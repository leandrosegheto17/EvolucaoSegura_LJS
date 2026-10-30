import type { MigrationBuilder } from 'node-pg-migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { down, up } from '../migrations/0026_rascunho_bytes.ts';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T219 / RAS-05, SEC-007: migration 0026 acrescenta rascunho.bytes, a medida do payload que a API
// grava para somar o teto de 25 MiB por profissional (decisão do usuário, 2026-10-30).
// - Coluna inteira >= 0, sem NOT NULL; a app a grava no INSERT e no UPDATE.
// - As linhas que já existiam recebem octet_length(payload::text), de todos os profissionais
//   (a RLS forçada não esconde linha nenhuma do preenchimento) e a RLS forçada volta no fim.
// - O down tira a coluna. A aplicação por role sem superusuário (Neon) fica no
//   migrations-sem-superusuario.test.ts, que roda todas as migrations.

const VIOLA_CHECK = '23514';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let banco: BancoDeTeste;

const sqlDe = (migracao: (pgm: MigrationBuilder) => void): string => {
  const partes: string[] = [];
  migracao({ sql: (texto: string) => partes.push(texto) } as unknown as MigrationBuilder);
  return partes.join('\n');
};

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

async function emTransacao(sql: string): Promise<void> {
  await banco.cliente.query('begin');
  try {
    await banco.cliente.query(sql);
    await banco.cliente.query('commit');
  } catch (erro) {
    await banco.cliente.query('rollback');
    throw erro;
  }
}

beforeAll(async () => {
  banco = await criarBancoMigrado('m0026');
  await banco.cliente.query(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

describe('coluna rascunho.bytes', () => {
  it('é inteira e aceita nulo', async () => {
    expect(
      await consultar(
        `select data_type, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'rascunho' and column_name = 'bytes'`,
      ),
    ).toEqual([{ data_type: 'integer', is_nullable: 'YES' }]);
  });

  it('recusa valor negativo', async () => {
    expect(
      await codigoDoErro(() =>
        comoRole(banco.cliente, null, () =>
          consultar(
            `insert into rascunho (usuario_id, tipo, ref, payload, bytes)
             values ($1, 'evolucao', gen_random_uuid()::text, '{}', -1)`,
            [A],
          ),
        ),
      ),
    ).toBe(VIOLA_CHECK);
  });

  it('a app grava bytes no INSERT e no UPDATE; a backup_ro só lê', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('evolucao_app', 'rascunho', 'bytes', 'INSERT') as app_insert,
              has_column_privilege('evolucao_app', 'rascunho', 'bytes', 'UPDATE') as app_update,
              has_column_privilege('evolucao_backup_ro', 'rascunho', 'bytes', 'SELECT') as backup_le,
              has_column_privilege('evolucao_backup_ro', 'rascunho', 'bytes', 'UPDATE') as backup_grava`,
    );
    expect(privilegios).toEqual({
      app_insert: true,
      app_update: true,
      backup_le: true,
      backup_grava: false,
    });
  });

  it('a app grava bytes no próprio rascunho, pela RLS', async () => {
    const gravados = await comoRole(
      banco.cliente,
      'evolucao_app',
      async () => {
        await consultar(
          `insert into rascunho (usuario_id, tipo, ref, payload, bytes)
           values ($1, 'evolucao', gen_random_uuid()::text, '{"t":"a"}', 9)`,
          [A],
        );
        await consultar(`update rascunho set bytes = 10 where usuario_id = $1`, [A]);
        return consultar<{ bytes: number }>('select bytes from rascunho');
      },
      A,
    );
    expect(gravados).toEqual([{ bytes: 10 }]);
  });
});

describe('preenchimento das linhas que já existiam', () => {
  it('down tira a coluna; up preenche octet_length(payload::text) de todos e mantém a RLS forçada', async () => {
    await emTransacao(sqlDe(down));
    expect(
      await consultar(
        `select 1 from information_schema.columns
         where table_name = 'rascunho' and column_name = 'bytes'`,
      ),
    ).toEqual([]);

    await consultar(
      `insert into rascunho (usuario_id, tipo, ref, payload)
       values ($1, 'evolucao', 'r-a', '{"texto":"ção"}'), ($2, 'anamnese', 'r-b', '{"a":1,"b":[1,2]}')`,
      [A, B],
    );
    await emTransacao(sqlDe(up));

    const linhas = await consultar<{ ref: string; bytes: number; esperado: number }>(
      `select ref, bytes, octet_length(payload::text) as esperado from rascunho
       where ref in ('r-a', 'r-b') order by ref`,
    );
    expect(linhas.map((l) => l.ref)).toEqual(['r-a', 'r-b']);
    for (const linha of linhas) expect(linha.bytes, linha.ref).toBe(linha.esperado);
    // jsonb::text acrescenta espaço depois de ":" e ",": {"texto": "ção"} tem 18 bytes.
    expect(linhas[0]!.bytes).toBe(18);

    const [tabela] = await consultar<{ forcada: boolean; ligada: boolean; dono: string }>(
      `select relforcerowsecurity as forcada, relrowsecurity as ligada,
              pg_get_userbyid(relowner) as dono
       from pg_class where oid = 'public.rascunho'::regclass`,
    );
    expect(tabela).toEqual({ forcada: true, ligada: true, dono: 'evolucao_owner' });
    const [{ usuario }] = (await consultar<{ usuario: string }>(
      'select current_user as usuario',
    )) as [{ usuario: string }];
    expect(usuario).not.toBe('evolucao_owner');
  });
});
