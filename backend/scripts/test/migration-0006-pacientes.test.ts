import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T67 / PAC-01, PAC-05, PAC-07, ISO-01, ISO-02, ISO-03, ISO-04: migration 0006 cria paciente e
// consentimento_tcle com RLS forçada e sem colunas de IA. Paciente: nome de 1 a 200 (obrigatório),
// telefone até 40, e-mail até 254 no formato x@y, endereço até 500, vazio não é gravado; nasce
// ativo e nunca é apagado (sem DELETE para a app). TCLE: só inclusão (finalidade 1 a 500, versão
// 1 a 50, data de calendário), sem UPDATE nem DELETE para ninguém, e só para paciente do próprio
// profissional.

const VIOLA_CHECK = '23514';
const VIOLA_FK = '23503';
const SO_INCLUSAO = 'ES001';
const SEM_PERMISSAO_OU_RLS = '42501';
const DATA_INVALIDA = '22008';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PACIENTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACIENTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0006');
  await banco.cliente.query(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
  await banco.cliente.query(
    `insert into paciente (id, usuario_id, nome) values ($1, $2, 'Paciente A'), ($3, $4, 'Paciente B')`,
    [PACIENTE_A, A, PACIENTE_B, B],
  );
  await banco.cliente.query(
    `insert into consentimento_tcle (usuario_id, paciente_id, finalidade, data_consentimento, versao_termo)
     values ($1, $2, 'Atendimento', '2026-10-01', 'v1'), ($3, $4, 'Atendimento', '2026-10-01', 'v1')`,
    [A, PACIENTE_A, B, PACIENTE_B],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

// Insere um paciente de A com as colunas dadas, numa transação desfeita.
function erroAoCriarPaciente(colunas: Record<string, unknown>): Promise<string | null> {
  const nomes = ['usuario_id', ...Object.keys(colunas)];
  const valores = [A, ...Object.values(colunas)];
  return comoRole(banco.cliente, null, () =>
    codigoDoErro(() =>
      banco.cliente.query(
        `insert into paciente (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`,
        valores,
      ),
    ),
  );
}

// Insere um TCLE do paciente de A, numa transação desfeita.
function erroAoCriarTcle(colunas: Record<string, unknown>): Promise<string | null> {
  const completo = {
    usuario_id: A,
    paciente_id: PACIENTE_A,
    finalidade: 'Atendimento',
    data_consentimento: '2026-10-01',
    versao_termo: 'v1',
    ...colunas,
  };
  const nomes = Object.keys(completo);
  return comoRole(banco.cliente, null, () =>
    codigoDoErro(() =>
      banco.cliente.query(
        `insert into consentimento_tcle (${nomes.join(', ')})
         values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(completo),
      ),
    ),
  );
}

describe('paciente: dados (PAC-01)', () => {
  it('nome obrigatório, de 1 a 200', async () => {
    expect(await erroAoCriarPaciente({ nome: 'x' })).toBeNull();
    expect(await erroAoCriarPaciente({ nome: 'x'.repeat(200) })).toBeNull();
    expect(await erroAoCriarPaciente({ nome: 'x'.repeat(201) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPaciente({ nome: '   ' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPaciente({ nome: null })).toBe('23502');
  });

  it('telefone até 40, e-mail até 254 e endereço até 500', async () => {
    const email254 = `${'x'.repeat(250)}@a.b`;
    expect(
      await erroAoCriarPaciente({
        nome: 'N',
        telefone: 'x'.repeat(40),
        email: email254,
        endereco: 'x'.repeat(500),
      }),
    ).toBeNull();
    expect(await erroAoCriarPaciente({ nome: 'N', telefone: 'x'.repeat(41) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPaciente({ nome: 'N', email: `x${email254}` })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPaciente({ nome: 'N', endereco: 'x'.repeat(501) })).toBe(VIOLA_CHECK);
  });

  it('e-mail no formato x@y, sem espaços', async () => {
    expect(await erroAoCriarPaciente({ nome: 'N', email: 'a@b' })).toBeNull();
    expect(await erroAoCriarPaciente({ nome: 'N', email: 'sem-arroba' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPaciente({ nome: 'N', email: 'a b@c' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPaciente({ nome: 'N', email: '@c' })).toBe(VIOLA_CHECK);
  });

  it('vazio não é gravado (a API converte em null)', async () => {
    expect(await erroAoCriarPaciente({ nome: 'N', telefone: '' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPaciente({ nome: 'N', email: ' ' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPaciente({ nome: 'N', endereco: '' })).toBe(VIOLA_CHECK);
  });

  it('nasce ativo, com row_version 1', async () => {
    expect(
      await consultar('select ativo, row_version from paciente where id = $1', [PACIENTE_A]),
    ).toEqual([{ ativo: true, row_version: 1 }]);
  });

  it('sem colunas de IA', async () => {
    const colunas = await consultar<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('paciente', 'consentimento_tcle')
         and column_name like '%ia\\_%'`,
    );
    expect(colunas).toEqual([]);
  });
});

describe('consentimento_tcle: dados (PAC-05)', () => {
  it('finalidade de 1 a 500 e versão de 1 a 50', async () => {
    expect(await erroAoCriarTcle({ finalidade: 'x'.repeat(500) })).toBeNull();
    expect(await erroAoCriarTcle({ finalidade: 'x'.repeat(501) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarTcle({ finalidade: '  ' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarTcle({ versao_termo: 'x'.repeat(50) })).toBeNull();
    expect(await erroAoCriarTcle({ versao_termo: 'x'.repeat(51) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarTcle({ versao_termo: '' })).toBe(VIOLA_CHECK);
  });

  it('data é uma data de calendário válida', async () => {
    expect(await erroAoCriarTcle({ data_consentimento: '2024-02-29' })).toBeNull();
    expect(await erroAoCriarTcle({ data_consentimento: '2026-02-30' })).toBe(DATA_INVALIDA);
  });

  it('só para paciente do mesmo profissional', async () => {
    expect(await erroAoCriarTcle({ paciente_id: PACIENTE_B })).toBe(VIOLA_FK);
  });
});

describe('consentimento_tcle: só inclusão (PAC-05)', () => {
  it('a app só tem SELECT e INSERT', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('app', 'consentimento_tcle', 'SELECT') as select,
              has_any_column_privilege('app', 'consentimento_tcle', 'INSERT') as insert,
              has_any_column_privilege('app', 'consentimento_tcle', 'UPDATE') as update,
              has_table_privilege('app', 'consentimento_tcle', 'DELETE') as delete,
              has_table_privilege('app', 'consentimento_tcle', 'TRUNCATE') as truncate`,
    );
    expect(privilegios).toEqual({
      select: true,
      insert: true,
      update: false,
      delete: false,
      truncate: false,
    });
  });

  it.each([
    ['UPDATE', "update consentimento_tcle set finalidade = 'outra'"],
    ['DELETE', 'delete from consentimento_tcle'],
    ['TRUNCATE', 'truncate consentimento_tcle'],
  ])('%s é barrado pelo trigger mesmo para owner e superusuário', async (_rotulo, comando) => {
    for (const role of [null, 'owner']) {
      const codigo = await comoRole(
        banco.cliente,
        role,
        () => codigoDoErro(() => banco.cliente.query(comando)),
        A,
      );
      expect(codigo, String(role)).toBe(SO_INCLUSAO);
    }
  });

  it('a app grava TCLE do próprio paciente', async () => {
    const codigo = await comoRole(
      banco.cliente,
      'app',
      () =>
        codigoDoErro(() =>
          banco.cliente.query(
            `insert into consentimento_tcle (usuario_id, paciente_id, finalidade, data_consentimento, versao_termo)
             values ($1, $2, 'Atendimento', '2026-10-02', 'v2')`,
            [A, PACIENTE_A],
          ),
        ),
      A,
    );
    expect(codigo).toBeNull();
  });
});

describe('paciente: nunca é apagado (PAC-07)', () => {
  it('a app lê, cria e troca só ativo; sem DELETE nem TRUNCATE', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('app', 'paciente', 'SELECT') as select,
              has_table_privilege('app', 'paciente', 'DELETE') as delete,
              has_table_privilege('app', 'paciente', 'TRUNCATE') as truncate,
              has_column_privilege('app', 'paciente', 'ativo', 'UPDATE') as update_ativo,
              has_column_privilege('app', 'paciente', 'usuario_id', 'UPDATE') as update_dono`,
    );
    expect(privilegios).toEqual({
      select: true,
      delete: false,
      truncate: false,
      update_ativo: true,
      update_dono: false,
    });
  });
});

describe.each(['paciente', 'consentimento_tcle'])(
  '%s: RLS forçada e isolamento (ISO-01)',
  (tabela) => {
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
      expect(new Set(await comoRole(banco.cliente, 'backup_ro', visiveis))).toEqual(
        new Set([A, B]),
      );
      const [privilegios] = await consultar<Record<string, boolean>>(
        `select has_table_privilege('backup_ro', $1, 'INSERT') as insert,
              has_table_privilege('backup_ro', $1, 'UPDATE') as update`,
        [tabela],
      );
      expect(privilegios).toEqual({ insert: false, update: false });
    });

    it('a app não tem DELETE nem TRUNCATE', async () => {
      const [privilegios] = await consultar<Record<string, boolean>>(
        `select has_table_privilege('app', $1, 'DELETE') as delete,
              has_table_privilege('app', $1, 'TRUNCATE') as truncate`,
        [tabela],
      );
      expect(privilegios).toEqual({ delete: false, truncate: false });
    });

    it('a app não cria linha em nome de outro profissional', async () => {
      const codigo = await comoRole(
        banco.cliente,
        'app',
        () =>
          codigoDoErro(() =>
            tabela === 'paciente'
              ? banco.cliente.query("insert into paciente (usuario_id, nome) values ($1, 'X')", [B])
              : banco.cliente.query(
                  `insert into consentimento_tcle (usuario_id, paciente_id, finalidade,
                     data_consentimento, versao_termo) values ($1, $2, 'F', '2026-10-01', 'v1')`,
                  [B, PACIENTE_B],
                ),
          ),
        A,
      );
      expect(codigo).toBe(SEM_PERMISSAO_OU_RLS);
    });
  },
);

describe('paciente: a app inativa só o que é dela', () => {
  it('troca ativo do próprio paciente; o de outro fica intacto', async () => {
    const alterados = await comoRole(
      banco.cliente,
      'app',
      async () =>
        (
          await banco.cliente.query(
            'update paciente set ativo = false, row_version = row_version + 1',
          )
        ).rowCount,
      A,
    );
    expect(alterados).toBe(1);
    expect(await consultar('select ativo from paciente where id = $1', [PACIENTE_B])).toEqual([
      { ativo: true },
    ]);
  });

  it('a app não troca o dono do paciente', async () => {
    const codigo = await comoRole(
      banco.cliente,
      'app',
      () => codigoDoErro(() => banco.cliente.query('update paciente set usuario_id = $1', [B])),
      A,
    );
    expect(codigo).toBe(SEM_PERMISSAO_OU_RLS);
  });
});
