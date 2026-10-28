import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T107 / FIN-01, FIN-02, FIN-08, ISO-01 a ISO-04: migration 0010 cria preco_paciente,
// preco_sessao e pagamento (valores em bigint centavos) e as revisões antes/depois de cada um.
// - Valor de 0 a 9.999.999.999 centavos por restrição (FIN-01).
// - Um preço por paciente, um ajuste por sessão e um pagamento por sessão (FIN-05).
// - Mudança de fato grava revisão antes/depois por trigger; sem mudança, nenhuma (FIN-02).
// - Revisões só de inclusão; a app não tem DELETE nem TRUNCATE em nenhuma tabela (FIN-08, ISO-03).
// - RLS forçada; evolucao_backup_ro lê tudo (ISO-01, ISO-04).

const VIOLA_CHECK = '23514';
const VIOLA_FK = '23503';
const VIOLA_UNICO = '23505';
const SO_INCLUSAO = 'ES001';
const SEM_PERMISSAO_OU_RLS = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PACIENTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACIENTE_A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const PACIENTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PACIENTE_B2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const SESSAO_A = 'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa';
const SESSAO_A2 = 'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaa2';
const SESSAO_B = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';
const SESSAO_B2 = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbb2';
const MAXIMO = '9999999999';
const TABELAS = [
  'preco_paciente',
  'preco_paciente_revisao',
  'preco_sessao',
  'preco_sessao_revisao',
  'pagamento',
  'pagamento_revisao',
] as const;
const PRINCIPAIS = ['preco_paciente', 'preco_sessao', 'pagamento'] as const;
type Principal = (typeof PRINCIPAIS)[number];
const REVISAO: Record<Principal, string> = {
  preco_paciente: 'preco_paciente_revisao',
  preco_sessao: 'preco_sessao_revisao',
  pagamento: 'pagamento_revisao',
};

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0010');
  const q = (sql: string, p: unknown[]) => banco.cliente.query(sql, p);
  await q(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
  await q(
    `insert into paciente (id, usuario_id, nome)
     values ($1, $2, 'Paciente A'), ($3, $2, 'Paciente A2'), ($4, $5, 'Paciente B'), ($6, $5, 'Paciente B2')`,
    [PACIENTE_A, A, PACIENTE_A2, PACIENTE_B, B, PACIENTE_B2],
  );
  await q(
    `insert into sessao_atendimento (id, usuario_id, paciente_id, inicio, fim)
     values ($1, $2, $3, now(), now() + interval '50 minutes'),
            ($4, $2, $3, now() + interval '1 day', now() + interval '1 day 50 minutes'),
            ($5, $6, $7, now(), now() + interval '50 minutes'),
            ($8, $6, $7, now() + interval '1 day', now() + interval '1 day 50 minutes')`,
    [SESSAO_A, A, PACIENTE_A, SESSAO_A2, SESSAO_B, B, PACIENTE_B, SESSAO_B2],
  );
  await q(
    `insert into preco_paciente (usuario_id, paciente_id, valor_centavos)
     values ($1, $2, 15000), ($3, $4, 20000)`,
    [A, PACIENTE_A, B, PACIENTE_B],
  );
  await q(
    `insert into preco_sessao (usuario_id, sessao_id, valor_centavos)
     values ($1, $2, 12000), ($3, $4, 12000)`,
    [A, SESSAO_A, B, SESSAO_B],
  );
  await q(
    `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
     values ($1, $2, 15000, '2026-10-01', 'pix'), ($3, $4, 20000, '2026-10-01', 'dinheiro')`,
    [A, SESSAO_A, B, SESSAO_B],
  );
  // Uma revisão de cada para o RLS das tabelas de revisão ter linha dos dois profissionais.
  for (const usuario of [A, B]) {
    await banco.cliente.query('begin');
    await banco.cliente.query("select set_config('app.usuario_id', $1, true)", [usuario]);
    for (const tabela of PRINCIPAIS)
      await banco.cliente.query(
        `update ${tabela} set valor_centavos = valor_centavos + 1, row_version = row_version + 1
         where usuario_id = $1`,
        [usuario],
      );
    await banco.cliente.query('commit');
  }
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

// Insere uma linha de A com as colunas dadas (sobre uma base válida), numa transação desfeita.
function erroAoCriar(tabela: Principal, colunas: Record<string, unknown>): Promise<string | null> {
  const bases: Record<Principal, Record<string, unknown>> = {
    preco_paciente: { usuario_id: A, paciente_id: PACIENTE_A2, valor_centavos: 100 },
    preco_sessao: { usuario_id: A, sessao_id: SESSAO_A2, valor_centavos: 100 },
    pagamento: {
      usuario_id: A,
      sessao_id: SESSAO_A2,
      valor_centavos: 100,
      data_pagamento: '2026-10-02',
      meio: 'cartao',
    },
  };
  const completo = { ...bases[tabela], ...colunas };
  const nomes = Object.keys(completo);
  return comoRole(banco.cliente, null, () =>
    codigoDoErro(() =>
      banco.cliente.query(
        `insert into ${tabela} (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(completo),
      ),
    ),
  );
}

describe.each(PRINCIPAIS)('%s: valor em centavos de 0 a 9.999.999.999 (FIN-01)', (tabela) => {
  it('a coluna é bigint', async () => {
    expect(
      await consultar(
        `select data_type from information_schema.columns
         where table_name = $1 and column_name = 'valor_centavos'`,
        [tabela],
      ),
    ).toEqual([{ data_type: 'bigint' }]);
  });

  it('aceita os limites 0 e 9.999.999.999', async () => {
    expect(await erroAoCriar(tabela, { valor_centavos: 0 })).toBeNull();
    expect(await erroAoCriar(tabela, { valor_centavos: MAXIMO })).toBeNull();
  });

  it('recusa negativo e acima do máximo', async () => {
    expect(await erroAoCriar(tabela, { valor_centavos: -1 })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar(tabela, { valor_centavos: '10000000000' })).toBe(VIOLA_CHECK);
  });

  it('recusa valor ausente', async () => {
    expect(await erroAoCriar(tabela, { valor_centavos: null })).toBe('23502');
  });
});

describe('um por dono (FIN-02, FIN-05)', () => {
  it('preco_paciente: um por paciente', async () => {
    expect(await erroAoCriar('preco_paciente', { paciente_id: PACIENTE_A })).toBe(VIOLA_UNICO);
  });

  it('preco_sessao: um por sessão', async () => {
    expect(await erroAoCriar('preco_sessao', { sessao_id: SESSAO_A })).toBe(VIOLA_UNICO);
  });

  it('pagamento: um por sessão', async () => {
    expect(await erroAoCriar('pagamento', { sessao_id: SESSAO_A })).toBe(VIOLA_UNICO);
    expect(
      await consultar(
        `select indexdef from pg_indexes where tablename = 'pagamento'
         and indexdef like '%UNIQUE%(sessao_id)'`,
      ),
    ).toHaveLength(1);
  });

  it('só de paciente e sessão do mesmo profissional', async () => {
    expect(await erroAoCriar('preco_paciente', { paciente_id: PACIENTE_B2 })).toBe(VIOLA_FK);
    expect(await erroAoCriar('preco_sessao', { sessao_id: SESSAO_B2 })).toBe(VIOLA_FK);
    expect(await erroAoCriar('pagamento', { sessao_id: SESSAO_B2 })).toBe(VIOLA_FK);
  });
});

describe('pagamento: data e meio (FIN-03)', () => {
  it('meio só da lista', async () => {
    for (const meio of ['dinheiro', 'pix', 'cartao', 'transferencia', 'outro'])
      expect(await erroAoCriar('pagamento', { meio }), meio).toBeNull();
    expect(await erroAoCriar('pagamento', { meio: 'cheque' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('pagamento', { meio: 'Pix' })).toBe(VIOLA_CHECK);
  });

  it('data é do tipo date', async () => {
    expect(
      await consultar(
        `select data_type from information_schema.columns
         where table_name = 'pagamento' and column_name = 'data_pagamento'`,
      ),
    ).toEqual([{ data_type: 'date' }]);
  });
});

describe.each(PRINCIPAIS)('%s: revisão antes/depois (FIN-02, FIN-05)', (tabela) => {
  const revisao = REVISAO[tabela];

  // Atualiza a linha de A como app e devolve as revisões novas.
  const atualizarComoApp = (set: string) =>
    comoRole(
      banco.cliente,
      'evolucao_app',
      async () => {
        const antes = await banco.cliente.query<{ total: number }>(
          `select count(*)::int as total from ${revisao}`,
        );
        await banco.cliente.query(`update ${tabela} set ${set} where usuario_id = $1`, [A]);
        const { rows } = await banco.cliente.query<{
          antes: { valor_centavos: number };
          depois: { valor_centavos: number };
          usuario_id: string;
        }>(`select antes, depois, usuario_id from ${revisao} order by id desc limit 1`);
        const depois = await banco.cliente.query<{ total: number }>(
          `select count(*)::int as total from ${revisao}`,
        );
        return { novas: depois.rows[0]!.total - antes.rows[0]!.total, ultima: rows[0] };
      },
      A,
    );

  it('mudança de valor grava uma revisão com antes e depois', async () => {
    const { novas, ultima } = await atualizarComoApp(
      'valor_centavos = 77777, row_version = row_version + 1',
    );
    expect(novas).toBe(1);
    expect(ultima?.usuario_id).toBe(A);
    expect(ultima?.depois.valor_centavos).toBe(77777);
    expect(ultima?.antes.valor_centavos).not.toBe(77777);
  });

  it('sem mudança de fato (só versão e data de atualização), nenhuma revisão', async () => {
    const { novas } = await atualizarComoApp('row_version = row_version, atualizado_em = now()');
    expect(novas).toBe(0);
  });

  it('a revisão é só de inclusão, mesmo para owner e superusuário', async () => {
    for (const comando of [
      `update ${revisao} set antes = '{}'`,
      `delete from ${revisao}`,
      `truncate ${revisao}`,
    ])
      for (const role of [null, 'evolucao_owner']) {
        const codigo = await comoRole(
          banco.cliente,
          role,
          () => codigoDoErro(() => banco.cliente.query(comando)),
          A,
        );
        expect(codigo, `${comando} ${String(role)}`).toBe(SO_INCLUSAO);
      }
  });

  it('a app só lê a revisão (quem grava é o trigger)', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_app', $1, 'SELECT') as select,
              has_any_column_privilege('evolucao_app', $1, 'INSERT') as insert,
              has_any_column_privilege('evolucao_app', $1, 'UPDATE') as update`,
      [revisao],
    );
    expect(privilegios).toEqual({ select: true, insert: false, update: false });
  });
});

describe('a app só muda o valor (e a data e o meio do pagamento)', () => {
  it.each([
    ['preco_paciente', 'paciente_id'],
    ['preco_sessao', 'sessao_id'],
    ['pagamento', 'sessao_id'],
  ])('%s: dono, %s e criado_em fixos', async (tabela, ref) => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('evolucao_app', $1, 'valor_centavos', 'UPDATE') as valor,
              has_column_privilege('evolucao_app', $1, 'row_version', 'UPDATE') as versao,
              has_column_privilege('evolucao_app', $1, $2, 'UPDATE') as ref,
              has_column_privilege('evolucao_app', $1, 'usuario_id', 'UPDATE') as dono,
              has_column_privilege('evolucao_app', $1, 'criado_em', 'UPDATE') as criado`,
      [tabela, ref],
    );
    expect(privilegios).toEqual({
      valor: true,
      versao: true,
      ref: false,
      dono: false,
      criado: false,
    });
  });

  it('pagamento: data e meio editáveis', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('evolucao_app', 'pagamento', 'data_pagamento', 'UPDATE') as data,
              has_column_privilege('evolucao_app', 'pagamento', 'meio', 'UPDATE') as meio`,
    );
    expect(privilegios).toEqual({ data: true, meio: true });
  });
});

describe('nada é apagado (FIN-08, ISO-03)', () => {
  it.each(TABELAS)('%s: a app não tem DELETE nem TRUNCATE', async (tabela) => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_app', $1, 'DELETE') as delete,
              has_table_privilege('evolucao_app', $1, 'TRUNCATE') as truncate`,
      [tabela],
    );
    expect(privilegios).toEqual({ delete: false, truncate: false });
  });
});

describe.each(TABELAS)('%s: RLS forçada e isolamento (ISO-01)', (tabela) => {
  const visiveis = async () =>
    (await consultar<{ usuario_id: string }>(`select usuario_id from ${tabela} order by 1`)).map(
      (l) => l.usuario_id,
    );

  it('tem RLS ativa e FORCE', async () => {
    expect(
      await consultar(
        'select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass',
        [`public.${tabela}`],
      ),
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it('o profissional só enxerga as próprias linhas', async () => {
    expect(new Set(await comoRole(banco.cliente, 'evolucao_app', visiveis, A))).toEqual(
      new Set([A]),
    );
    expect(new Set(await comoRole(banco.cliente, 'evolucao_app', visiveis, B))).toEqual(
      new Set([B]),
    );
  });

  it('sem usuário na transação, nenhuma linha (nem para owner)', async () => {
    expect(await comoRole(banco.cliente, 'evolucao_app', visiveis)).toEqual([]);
    expect(await comoRole(banco.cliente, 'evolucao_owner', visiveis)).toEqual([]);
  });

  it('evolucao_backup_ro lê todas as linhas e não escreve', async () => {
    expect(new Set(await comoRole(banco.cliente, 'evolucao_backup_ro', visiveis))).toEqual(
      new Set([A, B]),
    );
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_backup_ro', $1, 'INSERT') as insert,
              has_table_privilege('evolucao_backup_ro', $1, 'UPDATE') as update`,
      [tabela],
    );
    expect(privilegios).toEqual({ insert: false, update: false });
  });
});

describe('a app não cria linha em nome de outro profissional (ISO-02)', () => {
  it.each([
    [
      'preco_paciente',
      `insert into preco_paciente (usuario_id, paciente_id, valor_centavos) values ($1, $2, 1)`,
      PACIENTE_B2,
    ],
    [
      'preco_sessao',
      `insert into preco_sessao (usuario_id, sessao_id, valor_centavos) values ($1, $2, 1)`,
      SESSAO_B2,
    ],
    [
      'pagamento',
      `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
       values ($1, $2, 1, '2026-10-01', 'pix')`,
      SESSAO_B2,
    ],
  ])('%s', async (_tabela, comando, ref) => {
    const codigo = await comoRole(
      banco.cliente,
      'evolucao_app',
      () => codigoDoErro(() => banco.cliente.query(comando, [B, ref])),
      A,
    );
    expect(codigo).toBe(SEM_PERMISSAO_OU_RLS);
  });
});

describe('a app registra preço e pagamento do próprio paciente', () => {
  it('cria preço, ajuste e pagamento e corrige o pagamento', async () => {
    const resultado = await comoRole(
      banco.cliente,
      'evolucao_app',
      async () => {
        await banco.cliente.query(
          `insert into preco_paciente (usuario_id, paciente_id, valor_centavos) values ($1, $2, 9000)`,
          [A, PACIENTE_A2],
        );
        await banco.cliente.query(
          `insert into preco_sessao (usuario_id, sessao_id, valor_centavos) values ($1, $2, 8000)`,
          [A, SESSAO_A2],
        );
        await banco.cliente.query(
          `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
           values ($1, $2, 8000, '2026-10-03', 'transferencia')`,
          [A, SESSAO_A2],
        );
        return (
          await banco.cliente.query(
            `update pagamento set meio = 'pix', row_version = row_version + 1,
               atualizado_em = now() where sessao_id = $1`,
            [SESSAO_A2],
          )
        ).rowCount;
      },
      A,
    );
    expect(resultado).toBe(1);
  });
});
