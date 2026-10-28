import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T89 / ANA-02, ANA-03, ANA-04, ANA-05, ANA-06, ISO-01, ISO-02, ISO-03, ISO-04: migration 0008
// cria modelo_anamnese, modelo_anamnese_item, anamnese e anamnese_retificacao com RLS forçada.
// - anamnese guarda `valores jsonb` (objeto por id de item) e `modelo_revisao`; uma por paciente
//   (ANA-04); só editável no dia do cadastro em America/Sao_Paulo pelo relógio do banco (ANA-05).
// - retificação: nova versão com motivo de 1 a 5.000, só de inclusão (ANA-06).
// - item do modelo: rótulo aparado de 1 a 60, único sem diferenciar maiúsculas entre os itens
//   vigentes; no máximo um campo especial "Frequência", e só em campo (ANA-02). "Remover" é
//   marcar `removido`: a app não tem DELETE nem TRUNCATE em nenhuma das quatro (ISO-03).

const VIOLA_CHECK = '23514';
const VIOLA_FK = '23503';
const VIOLA_UNICO = '23505';
const SO_INCLUSAO = 'ES001';
const JANELA_FECHADA = 'ES002';
const SEM_PERMISSAO_OU_RLS = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PACIENTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACIENTE_A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const PACIENTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// Paciente de B sem anamnese (a FK é que tem de recusar, não a unicidade).
const PACIENTE_B2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const MODELO_A = 'aaaaaaaa-0000-4aaa-8aaa-aaaaaaaaaaaa';
const MODELO_B = 'bbbbbbbb-0000-4bbb-8bbb-bbbbbbbbbbbb';
const ANAMNESE_A = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const ANAMNESE_B = 'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb';
const TABELAS = [
  'modelo_anamnese',
  'modelo_anamnese_item',
  'anamnese',
  'anamnese_retificacao',
] as const;

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0008');
  const q = (sql: string, p: unknown[]) => banco.cliente.query(sql, p);
  await q(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
  await q(
    `insert into paciente (id, usuario_id, nome)
     values ($1, $2, 'Paciente A'), ($3, $2, 'Paciente A2'), ($4, $5, 'Paciente B'),
            ($6, $5, 'Paciente B2')`,
    [PACIENTE_A, A, PACIENTE_A2, PACIENTE_B, B, PACIENTE_B2],
  );
  await q(
    `insert into modelo_anamnese (id, usuario_id, especialidade)
     values ($1, $2, 'psicologia'), ($3, $4, 'nutricao')`,
    [MODELO_A, A, MODELO_B, B],
  );
  await q(
    `insert into modelo_anamnese_item (usuario_id, modelo_id, tipo, rotulo, ordem, revisao_inclusao)
     values ($1, $2, 'campo', 'Queixa principal', 0, 1), ($3, $4, 'campo', 'Sono', 0, 1)`,
    [A, MODELO_A, B, MODELO_B],
  );
  await q(
    `insert into anamnese (id, usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao)
     values ($1, $2, $3, $4, '2026-10-26', 1), ($5, $6, $7, $8, '2026-10-26', 1)`,
    [ANAMNESE_A, A, PACIENTE_A, MODELO_A, ANAMNESE_B, B, PACIENTE_B, MODELO_B],
  );
  // A regra "só depois do dia do cadastro" (ANA-07) é da API; o banco guarda a versão.
  await q(
    `insert into anamnese_retificacao (usuario_id, anamnese_id, seq, motivo, modelo_revisao, valores)
     values ($1, $2, 1, 'Correção', 1, '{}'), ($3, $4, 1, 'Correção', 1, '{}')`,
    [A, ANAMNESE_A, B, ANAMNESE_B],
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
  const bases: Record<(typeof TABELAS)[number], Record<string, unknown>> = {
    modelo_anamnese: { usuario_id: A, especialidade: 'fisioterapia' },
    modelo_anamnese_item: {
      usuario_id: A,
      modelo_id: MODELO_A,
      tipo: 'campo',
      rotulo: 'Abordagem',
      ordem: 1,
      revisao_inclusao: 1,
    },
    anamnese: {
      usuario_id: A,
      paciente_id: PACIENTE_A2,
      modelo_id: MODELO_A,
      data_sessao: '2026-10-26',
      modelo_revisao: 1,
    },
    anamnese_retificacao: {
      usuario_id: A,
      anamnese_id: ANAMNESE_A,
      seq: 2,
      motivo: 'Correção',
      modelo_revisao: 1,
      valores: '{}',
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

describe('anamnese: dados (ANA-04)', () => {
  it('guarda valores jsonb e modelo_revisao', async () => {
    expect(
      await consultar(
        `select column_name, data_type, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'anamnese'
           and column_name in ('valores', 'modelo_revisao') order by 1`,
      ),
    ).toEqual([
      { column_name: 'modelo_revisao', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'valores', data_type: 'jsonb', is_nullable: 'NO' },
    ]);
  });

  it('nasce com valores vazios e row_version 1', async () => {
    expect(
      await consultar('select valores, row_version from anamnese where id = $1', [ANAMNESE_A]),
    ).toEqual([{ valores: {}, row_version: 1 }]);
  });

  it('valores é um objeto por id de item', async () => {
    expect(await erroAoCriar('anamnese', { valores: '{"x": "texto"}' })).toBeNull();
    expect(await erroAoCriar('anamnese', { valores: '[]' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('anamnese', { valores: '"texto"' })).toBe(VIOLA_CHECK);
  });

  it('modelo_revisao a partir de 1', async () => {
    expect(await erroAoCriar('anamnese', { modelo_revisao: 0 })).toBe(VIOLA_CHECK);
  });

  it('uma anamnese por paciente', async () => {
    expect(await erroAoCriar('anamnese', { paciente_id: PACIENTE_A })).toBe(VIOLA_UNICO);
  });

  it('só de paciente e modelo do mesmo profissional', async () => {
    expect(await erroAoCriar('anamnese', { paciente_id: PACIENTE_B2 })).toBe(VIOLA_FK);
    expect(await erroAoCriar('anamnese', { modelo_id: MODELO_B })).toBe(VIOLA_FK);
  });
});

describe('anamnese: edição só no dia do cadastro (ANA-05)', () => {
  // Recua a criação da anamnese de A no relógio do banco e tenta editar como app.
  async function editarCriadaEm(criadoEm: string): Promise<string | null> {
    return comoRole(banco.cliente, null, async () => {
      await banco.cliente.query('set local session_replication_role = replica');
      await banco.cliente.query(`update anamnese set criado_em = ${criadoEm} where id = $1`, [
        ANAMNESE_A,
      ]);
      await banco.cliente.query('set local session_replication_role = origin');
      await banco.cliente.query("select set_config('app.usuario_id', $1, true)", [A]);
      await banco.cliente.query('set local role evolucao_app');
      return codigoDoErro(() =>
        banco.cliente.query(
          `update anamnese set valores = '{"x": "y"}', row_version = row_version + 1,
             atualizado_em = now() where id = $1`,
          [ANAMNESE_A],
        ),
      );
    });
  }
  // Meia-noite de hoje em America/Sao_Paulo, pelo relógio do banco.
  const MEIA_NOITE_HOJE = `((now() at time zone 'America/Sao_Paulo')::date::timestamp
    at time zone 'America/Sao_Paulo')`;

  it('criada hoje (desde a meia-noite de Brasília): edição aceita', async () => {
    expect(await editarCriadaEm(MEIA_NOITE_HOJE)).toBeNull();
    expect(await editarCriadaEm('now()')).toBeNull();
  });

  it('criada antes da meia-noite de Brasília: edição recusada', async () => {
    expect(await editarCriadaEm(`${MEIA_NOITE_HOJE} - interval '1 microsecond'`)).toBe(
      JANELA_FECHADA,
    );
    expect(await editarCriadaEm(`now() - interval '2 days'`)).toBe(JANELA_FECHADA);
  });

  it('a app só altera valores e modelo_revisao (paciente, modelo, data e dono fixos)', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('evolucao_app', 'anamnese', 'valores', 'UPDATE') as valores,
              has_column_privilege('evolucao_app', 'anamnese', 'modelo_revisao', 'UPDATE') as revisao,
              has_column_privilege('evolucao_app', 'anamnese', 'paciente_id', 'UPDATE') as paciente,
              has_column_privilege('evolucao_app', 'anamnese', 'modelo_id', 'UPDATE') as modelo,
              has_column_privilege('evolucao_app', 'anamnese', 'usuario_id', 'UPDATE') as dono,
              has_column_privilege('evolucao_app', 'anamnese', 'criado_em', 'UPDATE') as criado,
              has_column_privilege('evolucao_app', 'anamnese', 'criado_em', 'INSERT') as criado_insert`,
    );
    expect(privilegios).toEqual({
      valores: true,
      revisao: true,
      paciente: false,
      modelo: false,
      dono: false,
      criado: false,
      criado_insert: false,
    });
  });
});

describe('anamnese_retificacao: nova versão, só de inclusão (ANA-06)', () => {
  it('motivo de 1 a 5.000', async () => {
    expect(await erroAoCriar('anamnese_retificacao', { motivo: 'x'.repeat(5000) })).toBeNull();
    expect(await erroAoCriar('anamnese_retificacao', { motivo: 'x'.repeat(5001) })).toBe(
      VIOLA_CHECK,
    );
    expect(await erroAoCriar('anamnese_retificacao', { motivo: '   ' })).toBe(VIOLA_CHECK);
  });

  it('guarda a versão completa: valores jsonb (objeto) e modelo_revisao', async () => {
    expect(await erroAoCriar('anamnese_retificacao', { valores: '[]' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('anamnese_retificacao', { modelo_revisao: 0 })).toBe(VIOLA_CHECK);
  });

  it('seq único por anamnese', async () => {
    expect(await erroAoCriar('anamnese_retificacao', { seq: 1 })).toBe(VIOLA_UNICO);
  });

  it('só de anamnese do mesmo profissional', async () => {
    expect(await erroAoCriar('anamnese_retificacao', { anamnese_id: ANAMNESE_B })).toBe(VIOLA_FK);
  });

  it.each([
    ['UPDATE', "update anamnese_retificacao set motivo = 'outro'"],
    ['DELETE', 'delete from anamnese_retificacao'],
    ['TRUNCATE', 'truncate anamnese_retificacao'],
  ])('%s é barrado pelo trigger mesmo para owner e superusuário', async (_rotulo, comando) => {
    for (const role of [null, 'evolucao_owner']) {
      const codigo = await comoRole(
        banco.cliente,
        role,
        () => codigoDoErro(() => banco.cliente.query(comando)),
        A,
      );
      expect(codigo, String(role)).toBe(SO_INCLUSAO);
    }
  });

  it('a app só tem SELECT e INSERT', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_app', 'anamnese_retificacao', 'SELECT') as select,
              has_any_column_privilege('evolucao_app', 'anamnese_retificacao', 'INSERT') as insert,
              has_any_column_privilege('evolucao_app', 'anamnese_retificacao', 'UPDATE') as update`,
    );
    expect(privilegios).toEqual({ select: true, insert: true, update: false });
  });
});

describe('modelo de anamnese: itens (ANA-02, ANA-03)', () => {
  it('um modelo por especialidade do profissional', async () => {
    expect(await erroAoCriar('modelo_anamnese', { especialidade: 'psicologia' })).toBe(VIOLA_UNICO);
    expect(await erroAoCriar('modelo_anamnese', { especialidade: 'outra' })).toBeNull();
    expect(await erroAoCriar('modelo_anamnese', { especialidade: 'medicina' })).toBe(VIOLA_CHECK);
  });

  it('nasce na revisão 1', async () => {
    expect(
      await consultar('select revisao, row_version from modelo_anamnese where id = $1', [MODELO_A]),
    ).toEqual([{ revisao: 1, row_version: 1 }]);
  });

  it('rótulo aparado de 1 a 60', async () => {
    expect(await erroAoCriar('modelo_anamnese_item', { rotulo: 'x'.repeat(60) })).toBeNull();
    expect(await erroAoCriar('modelo_anamnese_item', { rotulo: 'x'.repeat(61) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('modelo_anamnese_item', { rotulo: '' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('modelo_anamnese_item', { rotulo: ' Abordagem' })).toBe(VIOLA_CHECK);
  });

  it('rótulo único no modelo sem diferenciar maiúsculas, entre os itens vigentes', async () => {
    expect(await erroAoCriar('modelo_anamnese_item', { rotulo: 'QUEIXA PRINCIPAL' })).toBe(
      VIOLA_UNICO,
    );
    expect(
      await erroAoCriar('modelo_anamnese_item', { rotulo: 'queixa principal', tipo: 'alerta' }),
    ).toBe(VIOLA_UNICO);
    expect(
      await erroAoCriar('modelo_anamnese_item', { rotulo: 'Queixa principal', removido: true }),
    ).toBeNull();
  });

  it('tipo campo ou alerta; especial só em campo', async () => {
    expect(await erroAoCriar('modelo_anamnese_item', { tipo: 'nota' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('modelo_anamnese_item', { tipo: 'alerta', especial: true })).toBe(
      VIOLA_CHECK,
    );
    expect(await erroAoCriar('modelo_anamnese_item', { especial: true })).toBeNull();
  });

  it('no máximo um campo especial "Frequência" vigente por modelo', async () => {
    const codigo = await comoRole(banco.cliente, null, async () => {
      await banco.cliente.query(
        `insert into modelo_anamnese_item (usuario_id, modelo_id, tipo, especial, rotulo, ordem, revisao_inclusao)
         values ($1, $2, 'campo', true, 'Frequência', 1, 1)`,
        [A, MODELO_A],
      );
      return codigoDoErro(() =>
        banco.cliente.query(
          `insert into modelo_anamnese_item (usuario_id, modelo_id, tipo, especial, rotulo, ordem, revisao_inclusao)
           values ($1, $2, 'campo', true, 'Frequência 2', 2, 1)`,
          [A, MODELO_A],
        ),
      );
    });
    expect(codigo).toBe(VIOLA_UNICO);
  });

  it('só de modelo do mesmo profissional', async () => {
    expect(await erroAoCriar('modelo_anamnese_item', { modelo_id: MODELO_B })).toBe(VIOLA_FK);
  });

  it('"remover" é marcar removido: a app não troca dono, modelo nem revisão de inclusão', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('evolucao_app', 'modelo_anamnese_item', 'removido', 'UPDATE') as removido,
              has_column_privilege('evolucao_app', 'modelo_anamnese_item', 'rotulo', 'UPDATE') as rotulo,
              has_column_privilege('evolucao_app', 'modelo_anamnese_item', 'ordem', 'UPDATE') as ordem,
              has_column_privilege('evolucao_app', 'modelo_anamnese_item', 'usuario_id', 'UPDATE') as dono,
              has_column_privilege('evolucao_app', 'modelo_anamnese_item', 'modelo_id', 'UPDATE') as modelo,
              has_column_privilege('evolucao_app', 'modelo_anamnese_item', 'revisao_inclusao', 'UPDATE') as inclusao,
              has_column_privilege('evolucao_app', 'modelo_anamnese', 'especialidade', 'UPDATE') as especialidade,
              has_column_privilege('evolucao_app', 'modelo_anamnese', 'revisao', 'UPDATE') as revisao`,
    );
    expect(privilegios).toEqual({
      removido: true,
      rotulo: true,
      ordem: true,
      dono: false,
      modelo: false,
      inclusao: false,
      especialidade: false,
      revisao: true,
    });
  });
});

describe('nada é apagado (ISO-03)', () => {
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

  it('a app não cria linha em nome de outro profissional', async () => {
    const comandos: Record<(typeof TABELAS)[number], [string, unknown[]]> = {
      modelo_anamnese: [
        `insert into modelo_anamnese (usuario_id, especialidade) values ($1, 'outra')`,
        [B],
      ],
      modelo_anamnese_item: [
        `insert into modelo_anamnese_item (usuario_id, modelo_id, tipo, rotulo, ordem, revisao_inclusao)
         values ($1, $2, 'campo', 'Outro', 1, 1)`,
        [B, MODELO_B],
      ],
      anamnese: [
        `insert into anamnese (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao)
         values ($1, $2, $3, '2026-10-26', 1)`,
        [B, PACIENTE_B, MODELO_B],
      ],
      anamnese_retificacao: [
        `insert into anamnese_retificacao (usuario_id, anamnese_id, seq, motivo, modelo_revisao, valores)
         values ($1, $2, 2, 'Correção', 1, '{}')`,
        [B, ANAMNESE_B],
      ],
    };
    const [comando, parametros] = comandos[tabela];
    const codigo = await comoRole(
      banco.cliente,
      'evolucao_app',
      () => codigoDoErro(() => banco.cliente.query(comando, parametros)),
      A,
    );
    expect(codigo).toBe(SEM_PERMISSAO_OU_RLS);
  });
});

describe('a app monta o modelo e registra a anamnese do próprio paciente', () => {
  it('cria modelo, item e anamnese e edita no dia', async () => {
    const resultado = await comoRole(
      banco.cliente,
      'evolucao_app',
      async () => {
        const { rows: modelo } = await banco.cliente.query<{ id: string }>(
          `insert into modelo_anamnese (usuario_id, especialidade) values ($1, 'fisioterapia')
           returning id`,
          [A],
        );
        const { rows: item } = await banco.cliente.query<{ id: string }>(
          `insert into modelo_anamnese_item (usuario_id, modelo_id, tipo, rotulo, ordem, revisao_inclusao)
           values ($1, $2, 'campo', 'Queixa', 0, 1) returning id`,
          [A, modelo[0]!.id],
        );
        const { rows: anamnese } = await banco.cliente.query<{ id: string }>(
          `insert into anamnese (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao, valores)
           values ($1, $2, $3, '2026-10-26', 1, $4) returning id`,
          [A, PACIENTE_A2, modelo[0]!.id, { [item[0]!.id]: 'dor lombar' }],
        );
        return (
          await banco.cliente.query(
            `update anamnese set valores = '{}', row_version = row_version + 1 where id = $1`,
            [anamnese[0]!.id],
          )
        ).rowCount;
      },
      A,
    );
    expect(resultado).toBe(1);
  });
});
