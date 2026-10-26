import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T61 / PERF-02, PERF-03, PERF-08, ISO-01, ISO-03, ISO-04: migration 0005 cria perfil e
// configuracao_usuario com RLS forçada. Uma linha de perfil por profissional, com uma única
// especialidade (psicologia, nutricao, fisioterapia ou outra com nome de 1 a 60) e registro
// profissional opcional; atende_sabado, atende_domingo e privacidade_agenda nascem falsos.
// A app lê, cria e altera só o que é dela, sem DELETE nem TRUNCATE.

const VIOLA_CHECK = '23514';
const DUPLICADO = '23505';
const SEM_PERMISSAO_OU_RLS = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0005');
  await banco.cliente.query(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
  await banco.cliente.query(`insert into perfil (usuario_id, nome) values ($1, 'A'), ($2, 'B')`, [
    A,
    B,
  ]);
  await banco.cliente.query(`insert into configuracao_usuario (usuario_id) values ($1), ($2)`, [
    A,
    B,
  ]);
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

// Cria um usuário novo e o perfil dele com as colunas dadas, numa transação desfeita.
async function erroAoCriarPerfil(colunas: Record<string, unknown>): Promise<string | null> {
  return comoRole(banco.cliente, null, async () => {
    const { rows } = await banco.cliente.query<{ id: string }>(
      "insert into usuario (email, nome) values ('novo@exemplo.com', 'N') returning id",
    );
    const nomes = ['usuario_id', ...Object.keys(colunas)];
    const valores = [rows[0]!.id, ...Object.values(colunas)];
    return codigoDoErro(() =>
      banco.cliente.query(
        `insert into perfil (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`,
        valores,
      ),
    );
  });
}

describe('perfil: uma especialidade por profissional (PERF-03)', () => {
  it('um único perfil por profissional', async () => {
    const codigo = await comoRole(banco.cliente, null, () =>
      codigoDoErro(() =>
        banco.cliente.query("insert into perfil (usuario_id, nome) values ($1, 'A de novo')", [A]),
      ),
    );
    expect(codigo).toBe(DUPLICADO);
  });

  it('a especialidade é uma coluna do perfil, não uma tabela de várias', async () => {
    const colunas = await consultar<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'perfil' and column_name like 'especialidade%'
       order by 1`,
    );
    expect(colunas.map((c) => c.column_name)).toEqual(['especialidade', 'especialidade_nome']);
    const outras = await consultar(
      "select 1 from pg_class where relname = 'perfil_especialidade' and relkind = 'r'",
    );
    expect(outras).toEqual([]);
  });

  it.each(['psicologia', 'nutricao', 'fisioterapia'])('aceita %s sem nome', async (tipo) => {
    expect(await erroAoCriarPerfil({ nome: 'N', especialidade: tipo })).toBeNull();
  });

  it('aceita perfil ainda sem especialidade (perfil incompleto, PERF-01)', async () => {
    expect(await erroAoCriarPerfil({ nome: 'N' })).toBeNull();
  });

  it.each(['medicina', 'Psicologia', ''])('recusa a especialidade %j', async (tipo) => {
    expect(await erroAoCriarPerfil({ nome: 'N', especialidade: tipo })).toBe(VIOLA_CHECK);
  });

  it('outra exige nome de 1 a 60', async () => {
    const outra = (nome: string | null) =>
      erroAoCriarPerfil({ nome: 'N', especialidade: 'outra', especialidade_nome: nome });
    expect(await outra('T')).toBeNull();
    expect(await outra('x'.repeat(60))).toBeNull();
    expect(await outra('x'.repeat(61))).toBe(VIOLA_CHECK);
    expect(await outra('')).toBe(VIOLA_CHECK);
    expect(await outra('   ')).toBe(VIOLA_CHECK);
    expect(await outra(null)).toBe(VIOLA_CHECK);
  });

  it('o nome da especialidade só existe para outra', async () => {
    expect(
      await erroAoCriarPerfil({
        nome: 'N',
        especialidade: 'psicologia',
        especialidade_nome: 'Clínica',
      }),
    ).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPerfil({ nome: 'N', especialidade_nome: 'Clínica' })).toBe(VIOLA_CHECK);
  });

  it('registro profissional opcional: conselho até 40, número até 40, região até 100', async () => {
    const registro = (conselho: string, numero: string, regiao: string) =>
      erroAoCriarPerfil({
        nome: 'N',
        especialidade: 'psicologia',
        conselho,
        numero_registro: numero,
        regiao,
      });
    expect(await registro('x'.repeat(40), 'x'.repeat(40), 'x'.repeat(100))).toBeNull();
    expect(await registro('x'.repeat(41), '1', 'SP')).toBe(VIOLA_CHECK);
    expect(await registro('CRP', 'x'.repeat(41), 'SP')).toBe(VIOLA_CHECK);
    expect(await registro('CRP', '1', 'x'.repeat(101))).toBe(VIOLA_CHECK);
  });

  it('registro profissional só com especialidade definida', async () => {
    expect(await erroAoCriarPerfil({ nome: 'N', conselho: 'CRP' })).toBe(VIOLA_CHECK);
  });
});

describe('perfil: limites dos dados (PERF-02)', () => {
  it('nome obrigatório, de 1 a 200', async () => {
    expect(await erroAoCriarPerfil({ nome: 'x'.repeat(200) })).toBeNull();
    expect(await erroAoCriarPerfil({ nome: 'x'.repeat(201) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPerfil({ nome: '  ' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPerfil({ nome: null })).toBe('23502');
  });

  it('contato até 200 e endereço até 300; vazio não é gravado (vira null)', async () => {
    expect(
      await erroAoCriarPerfil({ nome: 'N', contato: 'x'.repeat(200), endereco: 'x'.repeat(300) }),
    ).toBeNull();
    expect(await erroAoCriarPerfil({ nome: 'N', contato: 'x'.repeat(201) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPerfil({ nome: 'N', endereco: 'x'.repeat(301) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPerfil({ nome: 'N', contato: '' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriarPerfil({ nome: 'N', endereco: ' ' })).toBe(VIOLA_CHECK);
  });

  it('atende_sabado e atende_domingo com padrão falso', async () => {
    expect(
      await consultar(
        'select atende_sabado, atende_domingo, especialidade from perfil where usuario_id = $1',
        [A],
      ),
    ).toEqual([{ atende_sabado: false, atende_domingo: false, especialidade: null }]);
  });
});

describe('configuracao_usuario (PERF-08)', () => {
  it('privacidade_agenda com padrão falso', async () => {
    expect(
      await consultar('select privacidade_agenda from configuracao_usuario where usuario_id = $1', [
        A,
      ]),
    ).toEqual([{ privacidade_agenda: false }]);
  });

  it('sem opção de inatividade (nem de IA)', async () => {
    const colunas = await consultar<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'configuracao_usuario'
         and column_name not in ('id', 'usuario_id', 'criado_em', 'atualizado_em', 'row_version')
       order by 1`,
    );
    expect(colunas.map((c) => c.column_name)).toEqual(['privacidade_agenda']);
  });

  it('uma configuração por profissional', async () => {
    const codigo = await comoRole(banco.cliente, null, () =>
      codigoDoErro(() =>
        banco.cliente.query('insert into configuracao_usuario (usuario_id) values ($1)', [A]),
      ),
    );
    expect(codigo).toBe(DUPLICADO);
  });
});

describe.each(['perfil', 'configuracao_usuario'])(
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
      expect(await comoRole(banco.cliente, 'app', visiveis, A)).toEqual([A]);
      expect(await comoRole(banco.cliente, 'app', visiveis, B)).toEqual([B]);
    });

    it('sem usuário na transação, nenhuma linha (nem para owner)', async () => {
      expect(await comoRole(banco.cliente, 'app', visiveis)).toEqual([]);
      expect(await comoRole(banco.cliente, 'owner', visiveis)).toEqual([]);
    });

    it('backup_ro lê todas as linhas e não escreve', async () => {
      expect(await comoRole(banco.cliente, 'backup_ro', visiveis)).toEqual([A, B]);
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

    it('a app não troca o dono da linha', async () => {
      const codigo = await comoRole(
        banco.cliente,
        'app',
        () => codigoDoErro(() => banco.cliente.query(`update ${tabela} set usuario_id = $1`, [B])),
        A,
      );
      expect(codigo).toBe(SEM_PERMISSAO_OU_RLS);
    });
  },
);

describe('a app grava e altera só o que é dela', () => {
  const C = '33333333-3333-4333-8333-333333333333';

  beforeAll(async () => {
    await banco.cliente.query(
      "insert into usuario (id, email, nome) values ($1, 'c@exemplo.com', 'C')",
      [C],
    );
  });

  it('cria o perfil e a configuração do usuário da transação, não de outro', async () => {
    const inserir = (tabela: string, dono: string, usuarioDaTransacao: string) =>
      comoRole(
        banco.cliente,
        'app',
        () =>
          codigoDoErro(() =>
            tabela === 'perfil'
              ? banco.cliente.query("insert into perfil (usuario_id, nome) values ($1, 'C')", [
                  dono,
                ])
              : banco.cliente.query('insert into configuracao_usuario (usuario_id) values ($1)', [
                  dono,
                ]),
          ),
        usuarioDaTransacao,
      );
    for (const tabela of ['perfil', 'configuracao_usuario']) {
      expect(await inserir(tabela, C, C), tabela).toBeNull();
      expect(await inserir(tabela, C, A), tabela).toBe(SEM_PERMISSAO_OU_RLS);
    }
  });

  it('altera os próprios dados; os de outro ficam intactos', async () => {
    const alterados = await comoRole(
      banco.cliente,
      'app',
      async () => {
        const perfil = await banco.cliente.query(
          `update perfil set nome = 'A2', contato = 'c', endereco = 'e', atende_sabado = true,
             atende_domingo = true, especialidade = 'outra', especialidade_nome = 'Arte',
             conselho = 'X', numero_registro = '1', regiao = 'SP'`,
        );
        const config = await banco.cliente.query(
          'update configuracao_usuario set privacidade_agenda = true',
        );
        return [perfil.rowCount, config.rowCount];
      },
      A,
    );
    expect(alterados).toEqual([1, 1]);
    expect(await consultar('select nome from perfil where usuario_id = $1', [B])).toEqual([
      { nome: 'B' },
    ]);
  });
});
