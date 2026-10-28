import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T148 / CONTA-03, CONTA-05: migration 0022, exclusão de conta.
// - conta_excluida guarda só id, data do pedido e data da purga, sem dado pessoal (CONTA-05); a
//   app não lê nem grava (quem grava é a purga, T152); backup_ro lê.
// - O bloqueio é por usuario.bloqueado_exclusao_em (CONTA-03): a app grava e limpa a data.
// - token_email aceita os tipos exclusao (confirmação) e desistencia.

const SEM_PERMISSAO = '42501';
const VIOLA_CHECK = '23514';

let banco: BancoDeTeste;
let usuarioId: string;

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

beforeAll(async () => {
  banco = await criarBancoMigrado('m0022');
  const [u] = await consultar<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em) values ('ana@exemplo.com', 'Ana', now())
     returning id`,
  );
  usuarioId = u!.id;
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

describe('conta_excluida sem dado pessoal (CONTA-05)', () => {
  it('as colunas são exatamente id, data do pedido e data da purga', async () => {
    const colunas = await consultar<{ coluna: string; tipo: string; nula: string }>(
      `select column_name as coluna, data_type as tipo, is_nullable as nula
       from information_schema.columns
       where table_schema = 'public' and table_name = 'conta_excluida' order by ordinal_position`,
    );
    expect(colunas).toEqual([
      { coluna: 'id', tipo: 'uuid', nula: 'NO' },
      { coluna: 'pedido_em', tipo: 'timestamp with time zone', nula: 'NO' },
      { coluna: 'purgado_em', tipo: 'timestamp with time zone', nula: 'NO' },
    ]);
  });

  it('não depende da linha de usuario (a conta apagada deixa de existir)', async () => {
    const [fks] = await consultar<{ n: number }>(
      `select count(*)::int as n from pg_constraint
       where conrelid = 'public.conta_excluida'::regclass and contype = 'f'`,
    );
    expect(fks).toEqual({ n: 0 });
    const id = crypto.randomUUID();
    await consultar(
      `insert into conta_excluida (id, pedido_em, purgado_em)
       values ($1, '2026-10-01T12:00:00Z', '2026-10-31T12:00:00Z')`,
      [id],
    );
    expect(
      await consultar('select id, pedido_em, purgado_em from conta_excluida where id = $1', [id]),
    ).toEqual([
      {
        id,
        pedido_em: new Date('2026-10-01T12:00:00Z'),
        purgado_em: new Date('2026-10-31T12:00:00Z'),
      },
    ]);
  });

  it('a purga não vem antes do pedido', async () => {
    expect(
      await codigoDoErro(() =>
        consultar(
          `insert into conta_excluida (id, pedido_em, purgado_em)
           values (gen_random_uuid(), '2026-10-31T12:00:00Z', '2026-10-01T12:00:00Z')`,
        ),
      ),
    ).toBe(VIOLA_CHECK);
  });

  it('a app não lê, não grava, não altera e não apaga', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('app', 'conta_excluida', 'SELECT') as select,
              has_table_privilege('app', 'conta_excluida', 'INSERT') as insert,
              has_table_privilege('app', 'conta_excluida', 'UPDATE') as update,
              has_table_privilege('app', 'conta_excluida', 'DELETE') as delete,
              has_table_privilege('app', 'conta_excluida', 'TRUNCATE') as truncate`,
    );
    expect(privilegios).toEqual({
      select: false,
      insert: false,
      update: false,
      delete: false,
      truncate: false,
    });
    expect(
      await comoRole(banco.cliente, 'app', () =>
        codigoDoErro(() => consultar('select * from conta_excluida')),
      ),
    ).toBe(SEM_PERMISSAO);
  });

  it('backup_ro só lê; o dono é a role owner', async () => {
    const [linha] = await consultar<Record<string, unknown>>(
      `select has_table_privilege('backup_ro', 'conta_excluida', 'SELECT') as select,
              has_table_privilege('backup_ro', 'conta_excluida', 'INSERT') as insert,
              pg_get_userbyid(c.relowner) as dono
       from pg_class c where c.oid = 'public.conta_excluida'::regclass`,
    );
    expect(linha).toEqual({ select: true, insert: false, dono: 'owner' });
  });
});

describe('bloqueio por bloqueado_exclusao_em (CONTA-03)', () => {
  it('a app grava e limpa a data do bloqueio', async () => {
    const lido = await comoRole(banco.cliente, 'app', async () => {
      await consultar('update usuario set bloqueado_exclusao_em = now() where id = $1', [
        usuarioId,
      ]);
      const [bloqueado] = await consultar<{ b: Date | null }>(
        'select bloqueado_exclusao_em as b from usuario where id = $1',
        [usuarioId],
      );
      await consultar('update usuario set bloqueado_exclusao_em = null where id = $1', [usuarioId]);
      const [desbloqueado] = await consultar<{ b: Date | null }>(
        'select bloqueado_exclusao_em as b from usuario where id = $1',
        [usuarioId],
      );
      return { bloqueado: bloqueado!.b, desbloqueado: desbloqueado!.b };
    });
    expect(lido.bloqueado).toBeInstanceOf(Date);
    expect(lido.desbloqueado).toBeNull();
  });

  it('a app não apaga a conta', async () => {
    expect(
      await comoRole(banco.cliente, 'app', () =>
        codigoDoErro(() => consultar('delete from usuario where id = $1', [usuarioId])),
      ),
    ).toBe(SEM_PERMISSAO);
  });

  it('a purga acha as contas bloqueadas por índice da data do bloqueio', async () => {
    const [indice] = await consultar<{ definicao: string }>(
      `select pg_get_indexdef(i.indexrelid) as definicao from pg_index i
       where i.indexrelid = 'public.usuario_bloqueado_exclusao_idx'::regclass`,
    );
    expect(indice!.definicao).toContain('(bloqueado_exclusao_em)');
    expect(indice!.definicao).toContain('WHERE (bloqueado_exclusao_em IS NOT NULL)');
  });
});

describe('token_email aceita exclusao e desistencia', () => {
  it.each(['exclusao', 'desistencia'])('%s', async (tipo) => {
    expect(
      await comoRole(banco.cliente, 'app', () =>
        codigoDoErro(() =>
          consultar(
            `insert into token_email (usuario_id, tipo, token_hash, expira_em)
             values ($1, $2, $3, now() + interval '30 minutes')`,
            [usuarioId, tipo, Buffer.from(crypto.getRandomValues(new Uint8Array(32)))],
          ),
        ),
      ),
    ).toBeNull();
  });
});
