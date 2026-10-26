import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T74 / AGE-01, AGE-10, AGE-13, AGE-17, ISO-01, ISO-02, ISO-03, ISO-04: migration 0007 cria
// serie_recorrencia e sessao_atendimento com RLS forçada. Sessão: [inicio, fim) com fim > inicio,
// link até 500 começando com http:// ou https://, status da matriz (nasce agendada), cobravel com
// padrão falso e row_version. Série: semanal ou quinzenal, de 2 a 52 ocorrências. Nada é apagado:
// a app não tem DELETE nem TRUNCATE. Sessão e série só de paciente (e série) do mesmo
// profissional.

const VIOLA_CHECK = '23514';
const VIOLA_FK = '23503';
const SEM_PERMISSAO_OU_RLS = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PACIENTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACIENTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERIE_A = 'aaaaaaaa-0000-4aaa-8aaa-aaaaaaaaaaaa';
const SERIE_B = 'bbbbbbbb-0000-4bbb-8bbb-bbbbbbbbbbbb';
const SESSAO_A = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const TABELAS = ['serie_recorrencia', 'sessao_atendimento'] as const;

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0007');
  await banco.cliente.query(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
  await banco.cliente.query(
    `insert into paciente (id, usuario_id, nome) values ($1, $2, 'Paciente A'), ($3, $4, 'Paciente B')`,
    [PACIENTE_A, A, PACIENTE_B, B],
  );
  await banco.cliente.query(
    `insert into serie_recorrencia (id, usuario_id, paciente_id, frequencia, ocorrencias)
     values ($1, $2, $3, 'semanal', 4), ($4, $5, $6, 'quinzenal', 2)`,
    [SERIE_A, A, PACIENTE_A, SERIE_B, B, PACIENTE_B],
  );
  await banco.cliente.query(
    `insert into sessao_atendimento (id, usuario_id, paciente_id, inicio, fim)
     values ($1, $2, $3, '2026-11-02T13:00:00Z', '2026-11-02T13:50:00Z')`,
    [SESSAO_A, A, PACIENTE_A],
  );
  await banco.cliente.query(
    `insert into sessao_atendimento (usuario_id, paciente_id, serie_id, inicio, fim)
     values ($1, $2, $3, '2026-11-03T13:00:00Z', '2026-11-03T13:50:00Z')`,
    [B, PACIENTE_B, SERIE_B],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

// Insere uma linha de A com as colunas dadas (sobre uma base válida), numa transação desfeita.
function erroAoCriar(
  tabela: (typeof TABELAS)[number],
  colunas: Record<string, unknown>,
): Promise<string | null> {
  const base =
    tabela === 'sessao_atendimento'
      ? {
          usuario_id: A,
          paciente_id: PACIENTE_A,
          inicio: '2026-11-04T13:00:00Z',
          fim: '2026-11-04T13:50:00Z',
        }
      : { usuario_id: A, paciente_id: PACIENTE_A, frequencia: 'semanal', ocorrencias: 4 };
  const completo = { ...base, ...colunas };
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

describe('sessao_atendimento: dados (AGE-01, AGE-07, AGE-10)', () => {
  it('nasce agendada, não cobrável e com row_version 1', async () => {
    expect(
      await consultar(
        'select status, cobravel, row_version, link, serie_id from sessao_atendimento where id = $1',
        [SESSAO_A],
      ),
    ).toEqual([
      { status: 'agendada', cobravel: false, row_version: 1, link: null, serie_id: null },
    ]);
  });

  it('fim precisa ser depois do início', async () => {
    const instante = '2026-11-04T13:00:00Z';
    expect(await erroAoCriar('sessao_atendimento', { inicio: instante, fim: instante })).toBe(
      VIOLA_CHECK,
    );
    expect(
      await erroAoCriar('sessao_atendimento', { inicio: instante, fim: '2026-11-04T12:59:59Z' }),
    ).toBe(VIOLA_CHECK);
    expect(
      await erroAoCriar('sessao_atendimento', { inicio: instante, fim: '2026-11-04T13:00:01Z' }),
    ).toBeNull();
  });

  it('link opcional, até 500, começando com http:// ou https://', async () => {
    const longo = `https://exemplo.com/${'x'.repeat(480)}`;
    expect(longo).toHaveLength(500);
    expect(await erroAoCriar('sessao_atendimento', { link: longo })).toBeNull();
    expect(await erroAoCriar('sessao_atendimento', { link: `${longo}x` })).toBe(VIOLA_CHECK);
    expect(
      await erroAoCriar('sessao_atendimento', { link: 'http://meet.exemplo.com/a' }),
    ).toBeNull();
    expect(await erroAoCriar('sessao_atendimento', { link: 'ftp://exemplo.com' })).toBe(
      VIOLA_CHECK,
    );
    expect(await erroAoCriar('sessao_atendimento', { link: 'exemplo.com' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('sessao_atendimento', { link: '' })).toBe(VIOLA_CHECK);
  });

  it('status só da matriz', async () => {
    const instante = { inicio: '2026-11-05T13:00:00Z', fim: '2026-11-05T13:50:00Z' };
    for (const status of ['agendada', 'realizada', 'faltou', 'cancelada', 'remarcada']) {
      const codigo = await comoRole(banco.cliente, null, () =>
        codigoDoErro(() =>
          banco.cliente.query(
            `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim, status)
             values ($1, $2, $3, $4, $5)`,
            [A, PACIENTE_A, instante.inicio, instante.fim, status],
          ),
        ),
      );
      expect(codigo, status).toBeNull();
    }
    expect(await erroAoCriar('sessao_atendimento', { status: 'apagada' })).toBe(VIOLA_CHECK);
  });

  it('só de paciente e série do mesmo profissional', async () => {
    expect(await erroAoCriar('sessao_atendimento', { paciente_id: PACIENTE_B })).toBe(VIOLA_FK);
    expect(await erroAoCriar('sessao_atendimento', { serie_id: SERIE_B })).toBe(VIOLA_FK);
    expect(await erroAoCriar('sessao_atendimento', { serie_id: SERIE_A })).toBeNull();
  });
});

describe('serie_recorrencia: dados (AGE-13)', () => {
  it('semanal ou quinzenal', async () => {
    expect(await erroAoCriar('serie_recorrencia', { frequencia: 'quinzenal' })).toBeNull();
    expect(await erroAoCriar('serie_recorrencia', { frequencia: 'mensal' })).toBe(VIOLA_CHECK);
  });

  it('de 2 a 52 ocorrências', async () => {
    expect(await erroAoCriar('serie_recorrencia', { ocorrencias: 2 })).toBeNull();
    expect(await erroAoCriar('serie_recorrencia', { ocorrencias: 52 })).toBeNull();
    expect(await erroAoCriar('serie_recorrencia', { ocorrencias: 1 })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('serie_recorrencia', { ocorrencias: 53 })).toBe(VIOLA_CHECK);
  });

  it('nasce não cancelada, com row_version 1', async () => {
    expect(
      await consultar('select cancelada, row_version from serie_recorrencia where id = $1', [
        SERIE_A,
      ]),
    ).toEqual([{ cancelada: false, row_version: 1 }]);
  });

  it('só de paciente do mesmo profissional', async () => {
    expect(await erroAoCriar('serie_recorrencia', { paciente_id: PACIENTE_B })).toBe(VIOLA_FK);
  });
});

describe('nada é apagado (AGE-17, ISO-03)', () => {
  it.each(TABELAS)('%s: a app não tem DELETE nem TRUNCATE', async (tabela) => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('app', $1, 'DELETE') as delete,
              has_table_privilege('app', $1, 'TRUNCATE') as truncate`,
      [tabela],
    );
    expect(privilegios).toEqual({ delete: false, truncate: false });
  });

  it('a app não troca o dono nem a série de uma sessão', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('app', 'sessao_atendimento', 'usuario_id', 'UPDATE') as dono,
              has_column_privilege('app', 'sessao_atendimento', 'serie_id', 'UPDATE') as serie,
              has_column_privilege('app', 'sessao_atendimento', 'status', 'UPDATE') as status,
              has_column_privilege('app', 'sessao_atendimento', 'row_version', 'UPDATE') as versao,
              has_column_privilege('app', 'serie_recorrencia', 'usuario_id', 'UPDATE') as dono_serie,
              has_column_privilege('app', 'serie_recorrencia', 'cancelada', 'UPDATE') as cancelada`,
    );
    expect(privilegios).toEqual({
      dono: false,
      serie: false,
      status: true,
      versao: true,
      dono_serie: false,
      cancelada: true,
    });
  });

  it('a sessão nasce agendada: a app não escolhe o status ao criar', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('app', 'sessao_atendimento', 'status', 'INSERT') as status,
              has_column_privilege('app', 'sessao_atendimento', 'inicio', 'INSERT') as inicio`,
    );
    expect(privilegios).toEqual({ status: false, inicio: true });
  });
});

describe('row_version (design)', () => {
  it.each(TABELAS)('%s tem row_version inteiro, obrigatório, padrão 1', async (tabela) => {
    expect(
      await consultar(
        `select data_type, is_nullable, column_default from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = 'row_version'`,
        [tabela],
      ),
    ).toEqual([{ data_type: 'integer', is_nullable: 'NO', column_default: '1' }]);
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
    expect(new Set(await comoRole(banco.cliente, 'app', visiveis, A))).toEqual(new Set([A]));
    expect(new Set(await comoRole(banco.cliente, 'app', visiveis, B))).toEqual(new Set([B]));
  });

  it('sem usuário na transação, nenhuma linha (nem para owner)', async () => {
    expect(await comoRole(banco.cliente, 'app', visiveis)).toEqual([]);
    expect(await comoRole(banco.cliente, 'owner', visiveis)).toEqual([]);
  });

  it('backup_ro lê todas as linhas e não escreve', async () => {
    expect(new Set(await comoRole(banco.cliente, 'backup_ro', visiveis))).toEqual(new Set([A, B]));
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('backup_ro', $1, 'INSERT') as insert,
              has_table_privilege('backup_ro', $1, 'UPDATE') as update`,
      [tabela],
    );
    expect(privilegios).toEqual({ insert: false, update: false });
  });

  it('a app não cria linha em nome de outro profissional', async () => {
    const codigo = await comoRole(
      banco.cliente,
      'app',
      () =>
        codigoDoErro(() =>
          tabela === 'serie_recorrencia'
            ? banco.cliente.query(
                `insert into serie_recorrencia (usuario_id, paciente_id, frequencia, ocorrencias)
                 values ($1, $2, 'semanal', 4)`,
                [B, PACIENTE_B],
              )
            : banco.cliente.query(
                `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim)
                 values ($1, $2, '2026-11-06T13:00:00Z', '2026-11-06T13:50:00Z')`,
                [B, PACIENTE_B],
              ),
        ),
      A,
    );
    expect(codigo).toBe(SEM_PERMISSAO_OU_RLS);
  });

  it('a app altera só as próprias linhas', async () => {
    const coluna = tabela === 'serie_recorrencia' ? 'cancelada = true' : "status = 'cancelada'";
    const alteradas = await comoRole(
      banco.cliente,
      'app',
      async () =>
        (
          await banco.cliente.query(
            `update ${tabela} set ${coluna}, row_version = row_version + 1, atualizado_em = now()`,
          )
        ).rowCount,
      A,
    );
    expect(alteradas).toBeGreaterThanOrEqual(1);
    expect(await consultar(`select row_version from ${tabela} where usuario_id = $1`, [B])).toEqual(
      [{ row_version: 1 }],
    );
  });
});

describe('a app cria e remarca a própria sessão', () => {
  it('cria sessão do próprio paciente e move o horário', async () => {
    const resultado = await comoRole(
      banco.cliente,
      'app',
      async () => {
        const { rows } = await banco.cliente.query<{ id: string }>(
          `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim, link, cobravel)
           values ($1, $2, '2026-11-09T13:00:00Z', '2026-11-09T13:50:00Z', 'https://m.exemplo.com', true)
           returning id`,
          [A, PACIENTE_A],
        );
        return (
          await banco.cliente.query(
            `update sessao_atendimento set inicio = inicio + interval '1 hour',
               fim = fim + interval '1 hour', row_version = row_version + 1 where id = $1`,
            [rows[0]!.id],
          )
        ).rowCount;
      },
      A,
    );
    expect(resultado).toBe(1);
  });
});
