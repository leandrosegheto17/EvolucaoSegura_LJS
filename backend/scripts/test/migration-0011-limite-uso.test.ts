import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T120 / EXP-05, ISO-01 a ISO-04: migration 0011 cria limite_uso e public.contar_uso, o contador
// por chave e janela que guarda em tabela o limite de exportações (mais de 5 em 60 s = 429).
// - contar_uso(chave, janela_segundos) conta um uso do profissional da transação e devolve a
//   contagem da janela, incluindo este; a janela começa no primeiro uso e, vencida (now() >=
//   início + janela), a próxima chamada abre outra com contagem 1 (janela fixa do legado).
// - Atômico: chamadas simultâneas da mesma chave nunca devolvem a mesma contagem.
// - Cada profissional e cada chave têm o próprio contador; sem usuário na transação, recusa.
// - A app só lê a tabela e só conta pela função; sem DELETE nem TRUNCATE (ISO-03).
// - RLS forçada; evolucao_backup_ro lê tudo (ISO-01, ISO-04).

const SEM_PERMISSAO_OU_RLS = '42501';
const VIOLA_CHECK = '23514';
const PARAMETRO_INVALIDO = '22023';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const JANELA = 60;

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0011');
  await banco.cliente.query(
    `insert into usuario (id, email, nome)
     values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B'), ($3, 'c@exemplo.com', 'C')`,
    [A, B, C],
  );
  // Um contador de cada profissional já gravado, para o RLS ter linha dos dois.
  await banco.cliente.query(
    `insert into limite_uso (usuario_id, chave) values ($1, 'semente'), ($2, 'semente')`,
    [A, B],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

const contar = async (chave: string, janela = JANELA): Promise<number> =>
  (
    await banco.cliente.query<{ n: number }>('select public.contar_uso($1, $2) as n', [
      chave,
      janela,
    ])
  ).rows[0]!.n;

// Envelhece a janela do contador (como superusuário, que passa pelo RLS) na transação corrente.
const envelhecer = (usuario: string, chave: string, idade: string) =>
  banco.cliente.query(
    `update limite_uso set janela_inicio = now() - $3::interval
     where usuario_id = $1 and chave = $2`,
    [usuario, chave, idade],
  );

describe('contar_uso: contador por chave e janela (EXP-05)', () => {
  it('o primeiro uso abre a janela com 1 e os seguintes somam 1 cada', async () => {
    const contagens = await comoRole(
      banco.cliente,
      'evolucao_app',
      async () => {
        const lista: number[] = [];
        for (let i = 0; i < 6; i++) lista.push(await contar('exportacao'));
        return lista;
      },
      A,
    );
    expect(contagens).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('grava o contador do profissional da transação, com o início da janela', async () => {
    const linhas = await comoRole(
      banco.cliente,
      'evolucao_app',
      async () => {
        await contar('exportacao');
        await contar('exportacao');
        return consultar<{ usuario_id: string; contagem: number; agora: boolean }>(
          `select usuario_id, contagem, janela_inicio = now() as agora
           from limite_uso where chave = 'exportacao'`,
        );
      },
      A,
    );
    expect(linhas).toEqual([{ usuario_id: A, contagem: 2, agora: true }]);
  });

  it('cada chave tem o próprio contador', async () => {
    const contagens = await comoRole(
      banco.cliente,
      'evolucao_app',
      async () => [await contar('exportacao'), await contar('exportacao'), await contar('outra')],
      A,
    );
    expect(contagens).toEqual([1, 2, 1]);
  });

  it('cada profissional tem o próprio contador', async () => {
    await banco.cliente.query('begin');
    try {
      await banco.cliente.query('set local role evolucao_app');
      const usar = async (usuario: string) => {
        await banco.cliente.query("select set_config('app.usuario_id', $1, true)", [usuario]);
        return contar('exportacao');
      };
      expect([await usar(A), await usar(A), await usar(B), await usar(A), await usar(B)]).toEqual([
        1, 2, 1, 3, 2,
      ]);
    } finally {
      await banco.cliente.query('rollback');
    }
  });

  it('dentro da janela continua contando; vencida (início + janela), recomeça em 1', async () => {
    await banco.cliente.query('begin');
    try {
      await banco.cliente.query("select set_config('app.usuario_id', $1, true)", [A]);
      for (let i = 0; i < 5; i++) await contar('exportacao');
      await envelhecer(A, 'exportacao', '59.999 seconds');
      expect(await contar('exportacao')).toBe(6);
      await envelhecer(A, 'exportacao', '60 seconds');
      expect(await contar('exportacao')).toBe(1);
      const [linha] = await consultar<{ agora: boolean }>(
        `select janela_inicio = now() as agora from limite_uso
         where usuario_id = $1 and chave = 'exportacao'`,
        [A],
      );
      expect(linha).toEqual({ agora: true });
      expect(await contar('exportacao')).toBe(2);
    } finally {
      await banco.cliente.query('rollback');
    }
  });

  it('a janela é o parâmetro da chamada', async () => {
    await banco.cliente.query('begin');
    try {
      await banco.cliente.query("select set_config('app.usuario_id', $1, true)", [A]);
      await contar('curta', 10);
      await envelhecer(A, 'curta', '10 seconds');
      expect(await contar('curta', 10)).toBe(1);
      await envelhecer(A, 'curta', '10 seconds');
      expect(await contar('curta', 3600)).toBe(2);
    } finally {
      await banco.cliente.query('rollback');
    }
  });

  it('chamadas simultâneas não perdem contagem (atômico)', async () => {
    const N = 12;
    const clientes = Array.from(
      { length: N },
      () => new pg.Client({ connectionString: banco.url }),
    );
    await Promise.all(clientes.map((c) => c.connect()));
    try {
      const contagens = await Promise.all(
        clientes.map(async (c) => {
          await c.query('begin');
          await c.query("select set_config('app.usuario_id', $1, true)", [C]);
          await c.query('set local role evolucao_app');
          const { rows } = await c.query<{ n: number }>(
            "select public.contar_uso('exportacao', 60) as n",
          );
          await c.query('commit');
          return rows[0]!.n;
        }),
      );
      expect([...contagens].sort((x, y) => x - y)).toEqual(
        Array.from({ length: N }, (_, i) => i + 1),
      );
      expect(await consultar(`select contagem from limite_uso where usuario_id = $1`, [C])).toEqual(
        [{ contagem: N }],
      );
    } finally {
      await Promise.all(clientes.map((c) => c.end()));
    }
  });

  it('sem usuário na transação, recusa', async () => {
    expect(
      await comoRole(banco.cliente, 'evolucao_app', () => codigoDoErro(() => contar('exportacao'))),
    ).toBe(SEM_PERMISSAO_OU_RLS);
  });

  it('recusa chave fora do formato e janela menor que 1 s', async () => {
    for (const chave of ['', 'Exportacao', 'com espaço', 'x'.repeat(101)])
      expect(
        await comoRole(banco.cliente, 'evolucao_app', () => codigoDoErro(() => contar(chave)), A),
        JSON.stringify(chave),
      ).toBe(VIOLA_CHECK);
    for (const janela of [0, -1])
      expect(
        await comoRole(
          banco.cliente,
          'evolucao_app',
          () => codigoDoErro(() => contar('x', janela)),
          A,
        ),
      ).toBe(PARAMETRO_INVALIDO);
  });

  it('é SECURITY DEFINER do owner com search_path fixo e a app a executa', async () => {
    expect(
      await consultar(
        `select pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer,
                exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                        where c like 'search_path=%') as search_path_fixo,
                has_function_privilege('evolucao_app', p.oid, 'EXECUTE') as app,
                has_function_privilege('evolucao_backup_ro', p.oid, 'EXECUTE') as evolucao_backup_ro
         from pg_proc p where p.oid = 'public.contar_uso(text, integer)'::regprocedure`,
      ),
    ).toEqual([
      {
        dono: 'evolucao_owner',
        definer: true,
        search_path_fixo: true,
        app: true,
        evolucao_backup_ro: false,
      },
    ]);
  });
});

describe('a app só conta pela função (ISO-03)', () => {
  it('a app só lê a tabela: sem INSERT, UPDATE, DELETE nem TRUNCATE', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_app', 'limite_uso', 'SELECT') as select,
              has_any_column_privilege('evolucao_app', 'limite_uso', 'INSERT') as insert,
              has_any_column_privilege('evolucao_app', 'limite_uso', 'UPDATE') as update,
              has_table_privilege('evolucao_app', 'limite_uso', 'DELETE') as delete,
              has_table_privilege('evolucao_app', 'limite_uso', 'TRUNCATE') as truncate`,
    );
    expect(privilegios).toEqual({
      select: true,
      insert: false,
      update: false,
      delete: false,
      truncate: false,
    });
  });

  it.each([
    ["insert into limite_uso (usuario_id, chave) values ($1, 'exportacao')"],
    ['update limite_uso set contagem = 1 where usuario_id = $1'],
    ['delete from limite_uso where usuario_id = $1'],
  ])('a app não zera nem forja o contador: %s', async (comando) => {
    expect(
      await comoRole(
        banco.cliente,
        'evolucao_app',
        () => codigoDoErro(() => banco.cliente.query(comando, [A])),
        A,
      ),
    ).toBe(SEM_PERMISSAO_OU_RLS);
  });
});

describe('limite_uso: RLS forçada e isolamento (ISO-01, ISO-04)', () => {
  const visiveis = async () =>
    (
      await consultar<{ usuario_id: string }>(
        `select usuario_id from limite_uso where chave = 'semente' order by 1`,
      )
    ).map((l) => l.usuario_id);

  it('tem RLS ativa e FORCE', async () => {
    expect(
      await consultar(
        `select relrowsecurity, relforcerowsecurity from pg_class
         where oid = 'public.limite_uso'::regclass`,
      ),
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it('o profissional só enxerga o próprio contador', async () => {
    expect(await comoRole(banco.cliente, 'evolucao_app', visiveis, A)).toEqual([A]);
    expect(await comoRole(banco.cliente, 'evolucao_app', visiveis, B)).toEqual([B]);
  });

  it('sem usuário na transação, nenhuma linha (nem para owner)', async () => {
    expect(await comoRole(banco.cliente, 'evolucao_app', visiveis)).toEqual([]);
    expect(await comoRole(banco.cliente, 'evolucao_owner', visiveis)).toEqual([]);
  });

  it('evolucao_backup_ro lê todas as linhas e não escreve', async () => {
    expect(await comoRole(banco.cliente, 'evolucao_backup_ro', visiveis)).toEqual([A, B]);
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_backup_ro', 'limite_uso', 'INSERT') as insert,
              has_table_privilege('evolucao_backup_ro', 'limite_uso', 'UPDATE') as update`,
    );
    expect(privilegios).toEqual({ insert: false, update: false });
  });

  it('contar_uso de B não mexe no contador de A', async () => {
    const contagemDeA = await comoRole(
      banco.cliente,
      'evolucao_app',
      async () => {
        await contar('semente');
        await contar('semente');
        return consultar<{ usuario_id: string; contagem: number }>(
          `select usuario_id, contagem from limite_uso where chave = 'semente'`,
        );
      },
      B,
    );
    expect(contagemDeA).toEqual([{ usuario_id: B, contagem: 3 }]);
    expect(
      await consultar(
        `select contagem from limite_uso where usuario_id = $1 and chave = 'semente'`,
        [A],
      ),
    ).toEqual([{ contagem: 1 }]);
  });
});
