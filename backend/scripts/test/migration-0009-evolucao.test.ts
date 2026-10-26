import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T98 / EVO-01, EVO-02, EVO-04, EVO-05, EVO-07, RAS-01, RAS-03, ISO-01 a ISO-04: migration 0009
// cria evolucao, evolucao_retificacao, rascunho e modelo_texto com RLS forçada.
// - Segunda evolução da mesma sessão é violada pelo banco (índice único parcial em sessao_id);
//   evolução sem sessão não esbarra nesse índice (EVO-02).
// - Texto não vazio depois de aparar, até 100.000 (EVO-01); retificação com texto e motivo até
//   100.000 cada, só de inclusão (EVO-05).
// - Evolução editável só no dia do cadastro em America/Sao_Paulo pelo relógio do banco (EVO-04).
// - Rascunho único por (profissional, tipo, ref) (RAS-01); modelo de texto só do tipo `evolucao`,
//   nome de 1 a 200 único sem diferenciar maiúsculas, corpo até 50.000, arquivável (RAS-03).
// - Sem DELETE nem TRUNCATE para a app em nenhuma das quatro (EVO-07, ISO-03).

const VIOLA_CHECK = '23514';
const VIOLA_FK = '23503';
const VIOLA_UNICO = '23505';
const SO_INCLUSAO = 'ES001';
const JANELA_FECHADA = 'ES002';
const SEM_PERMISSAO_OU_RLS = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PACIENTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACIENTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSAO_A = 'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa';
const SESSAO_A2 = 'aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaa2';
const SESSAO_B = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';
// Sessão de B sem evolução (a FK é que tem de recusar, não a unicidade).
const SESSAO_B2 = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbb2';
const EVOLUCAO_A = 'aaaaaaaa-3333-4aaa-8aaa-aaaaaaaaaaaa';
const EVOLUCAO_B = 'bbbbbbbb-3333-4bbb-8bbb-bbbbbbbbbbbb';
const TABELAS = ['evolucao', 'evolucao_retificacao', 'rascunho', 'modelo_texto'] as const;

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0009');
  const q = (sql: string, p: unknown[]) => banco.cliente.query(sql, p);
  await q(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
  await q(
    `insert into paciente (id, usuario_id, nome) values ($1, $2, 'Paciente A'), ($3, $4, 'Paciente B')`,
    [PACIENTE_A, A, PACIENTE_B, B],
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
    `insert into evolucao (id, usuario_id, paciente_id, sessao_id, texto)
     values ($1, $2, $3, $4, 'Evolução A'), ($5, $6, $7, $8, 'Evolução B')`,
    [EVOLUCAO_A, A, PACIENTE_A, SESSAO_A, EVOLUCAO_B, B, PACIENTE_B, SESSAO_B],
  );
  // A regra "só depois do dia do cadastro" (EVO-06) é da API; o banco guarda a versão.
  await q(
    `insert into evolucao_retificacao (usuario_id, evolucao_id, seq, texto, motivo)
     values ($1, $2, 1, 'Novo', 'Correção'), ($3, $4, 1, 'Novo', 'Correção')`,
    [A, EVOLUCAO_A, B, EVOLUCAO_B],
  );
  await q(
    `insert into rascunho (usuario_id, tipo, ref, payload)
     values ($1, 'evolucao', $2, '{"texto": "a"}'), ($3, 'evolucao', $4, '{"texto": "b"}')`,
    [A, PACIENTE_A, B, PACIENTE_B],
  );
  await q(
    `insert into modelo_texto (usuario_id, tipo, nome, corpo)
     values ($1, 'evolucao', 'Padrão', 'Corpo'), ($2, 'evolucao', 'Padrão', 'Corpo')`,
    [A, B],
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
    evolucao: { usuario_id: A, paciente_id: PACIENTE_A, texto: 'Sessão tranquila' },
    evolucao_retificacao: {
      usuario_id: A,
      evolucao_id: EVOLUCAO_A,
      seq: 2,
      texto: 'Texto novo',
      motivo: 'Correção',
    },
    rascunho: { usuario_id: A, tipo: 'evolucao', ref: SESSAO_A2, payload: '{}' },
    modelo_texto: { usuario_id: A, tipo: 'evolucao', nome: 'Retorno', corpo: '' },
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

describe('evolucao: uma por sessão (EVO-02)', () => {
  it('segunda evolução da mesma sessão é violada pelo banco', async () => {
    expect(await erroAoCriar('evolucao', { sessao_id: SESSAO_A })).toBe(VIOLA_UNICO);
  });

  it('outra sessão do mesmo paciente aceita', async () => {
    expect(await erroAoCriar('evolucao', { sessao_id: SESSAO_A2 })).toBeNull();
  });

  it('evoluções sem sessão não esbarram no índice (único parcial em sessao_id)', async () => {
    const total = await comoRole(banco.cliente, null, async () => {
      for (let i = 0; i < 2; i++)
        await banco.cliente.query(
          `insert into evolucao (usuario_id, paciente_id, texto) values ($1, $2, 'Sem sessão')`,
          [A, PACIENTE_A],
        );
      return (
        await banco.cliente.query<{ total: number }>(
          'select count(*)::int as total from evolucao where sessao_id is null and paciente_id = $1',
          [PACIENTE_A],
        )
      ).rows[0]!.total;
    });
    expect(total).toBe(2);
    expect(
      await consultar(
        `select indexdef like '%WHERE (sessao_id IS NOT NULL)%' as parcial
         from pg_indexes where tablename = 'evolucao' and indexname = 'evolucao_sessao_uq'`,
      ),
    ).toEqual([{ parcial: true }]);
  });

  it('só de paciente e sessão do mesmo profissional', async () => {
    expect(await erroAoCriar('evolucao', { paciente_id: PACIENTE_B })).toBe(VIOLA_FK);
    expect(await erroAoCriar('evolucao', { sessao_id: SESSAO_B2 })).toBe(VIOLA_FK);
  });
});

describe('evolucao: texto (EVO-01)', () => {
  it('não vazio depois de aparar, até 100.000', async () => {
    expect(await erroAoCriar('evolucao', { texto: 'x'.repeat(100_000) })).toBeNull();
    expect(await erroAoCriar('evolucao', { texto: 'x'.repeat(100_001) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('evolucao', { texto: '' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('evolucao', { texto: '  \n ' })).toBe(VIOLA_CHECK);
  });

  it('nasce com row_version 1', async () => {
    expect(await consultar('select row_version from evolucao where id = $1', [EVOLUCAO_A])).toEqual(
      [{ row_version: 1 }],
    );
  });
});

describe('evolucao: edição só no dia do cadastro (EVO-04)', () => {
  // Recua a criação da evolução de A no relógio do banco e tenta editar como app.
  async function editarCriadaEm(criadoEm: string): Promise<string | null> {
    return comoRole(banco.cliente, null, async () => {
      await banco.cliente.query('set local session_replication_role = replica');
      await banco.cliente.query(`update evolucao set criado_em = ${criadoEm} where id = $1`, [
        EVOLUCAO_A,
      ]);
      await banco.cliente.query('set local session_replication_role = origin');
      await banco.cliente.query("select set_config('app.usuario_id', $1, true)", [A]);
      await banco.cliente.query('set local role app');
      return codigoDoErro(() =>
        banco.cliente.query(
          `update evolucao set texto = 'Outro texto', row_version = row_version + 1,
             atualizado_em = now() where id = $1`,
          [EVOLUCAO_A],
        ),
      );
    });
  }
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

  it('a app só altera o texto (paciente, sessão, dono e data fixos)', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('app', 'evolucao', 'texto', 'UPDATE') as texto,
              has_column_privilege('app', 'evolucao', 'paciente_id', 'UPDATE') as paciente,
              has_column_privilege('app', 'evolucao', 'sessao_id', 'UPDATE') as sessao,
              has_column_privilege('app', 'evolucao', 'usuario_id', 'UPDATE') as dono,
              has_column_privilege('app', 'evolucao', 'criado_em', 'UPDATE') as criado,
              has_column_privilege('app', 'evolucao', 'criado_em', 'INSERT') as criado_insert`,
    );
    expect(privilegios).toEqual({
      texto: true,
      paciente: false,
      sessao: false,
      dono: false,
      criado: false,
      criado_insert: false,
    });
  });
});

describe('evolucao_retificacao: texto novo e motivo, só de inclusão (EVO-05)', () => {
  it('texto e motivo não vazios, até 100.000 cada', async () => {
    expect(
      await erroAoCriar('evolucao_retificacao', {
        texto: 'x'.repeat(100_000),
        motivo: 'y'.repeat(100_000),
      }),
    ).toBeNull();
    expect(await erroAoCriar('evolucao_retificacao', { texto: 'x'.repeat(100_001) })).toBe(
      VIOLA_CHECK,
    );
    expect(await erroAoCriar('evolucao_retificacao', { motivo: 'y'.repeat(100_001) })).toBe(
      VIOLA_CHECK,
    );
    expect(await erroAoCriar('evolucao_retificacao', { texto: '   ' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('evolucao_retificacao', { motivo: '   ' })).toBe(VIOLA_CHECK);
  });

  it('seq único por evolução', async () => {
    expect(await erroAoCriar('evolucao_retificacao', { seq: 1 })).toBe(VIOLA_UNICO);
  });

  it('só de evolução do mesmo profissional', async () => {
    expect(await erroAoCriar('evolucao_retificacao', { evolucao_id: EVOLUCAO_B })).toBe(VIOLA_FK);
  });

  it.each([
    ['UPDATE', "update evolucao_retificacao set motivo = 'outro'"],
    ['DELETE', 'delete from evolucao_retificacao'],
    ['TRUNCATE', 'truncate evolucao_retificacao'],
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

  it('a original fica intacta: a app só tem SELECT e INSERT na retificação', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('app', 'evolucao_retificacao', 'SELECT') as select,
              has_any_column_privilege('app', 'evolucao_retificacao', 'INSERT') as insert,
              has_any_column_privilege('app', 'evolucao_retificacao', 'UPDATE') as update`,
    );
    expect(privilegios).toEqual({ select: true, insert: true, update: false });
  });
});

describe('rascunho: um por (profissional, tipo, ref) (RAS-01)', () => {
  it('a mesma chave do mesmo profissional é violada', async () => {
    expect(await erroAoCriar('rascunho', { ref: PACIENTE_A })).toBe(VIOLA_UNICO);
    expect(await erroAoCriar('rascunho', { ref: PACIENTE_A, tipo: 'anamnese' })).toBeNull();
  });

  it('payload é um objeto JSON', async () => {
    expect(await erroAoCriar('rascunho', { payload: '{"texto": "x"}' })).toBeNull();
    expect(await erroAoCriar('rascunho', { payload: '[]' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('rascunho', { payload: '"texto"' })).toBe(VIOLA_CHECK);
  });

  it('tipo e ref no formato do legado (1 a 120 de [A-Za-z0-9._:-])', async () => {
    expect(await erroAoCriar('rascunho', { tipo: 'x'.repeat(120) })).toBeNull();
    expect(await erroAoCriar('rascunho', { tipo: 'x'.repeat(121) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('rascunho', { ref: '' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('rascunho', { ref: 'texto livre' })).toBe(VIOLA_CHECK);
  });

  it('upsert substitui o payload: a app só troca payload e versão', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('app', 'rascunho', 'payload', 'UPDATE') as payload,
              has_column_privilege('app', 'rascunho', 'row_version', 'UPDATE') as versao,
              has_column_privilege('app', 'rascunho', 'tipo', 'UPDATE') as tipo,
              has_column_privilege('app', 'rascunho', 'ref', 'UPDATE') as ref,
              has_column_privilege('app', 'rascunho', 'usuario_id', 'UPDATE') as dono`,
    );
    expect(privilegios).toEqual({
      payload: true,
      versao: true,
      tipo: false,
      ref: false,
      dono: false,
    });
  });
});

describe('modelo_texto (RAS-03)', () => {
  it('só do tipo evolucao', async () => {
    expect(await erroAoCriar('modelo_texto', { tipo: 'relatorio' })).toBe(VIOLA_CHECK);
  });

  it('nome aparado de 1 a 200', async () => {
    expect(await erroAoCriar('modelo_texto', { nome: 'x'.repeat(200) })).toBeNull();
    expect(await erroAoCriar('modelo_texto', { nome: 'x'.repeat(201) })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('modelo_texto', { nome: '' })).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('modelo_texto', { nome: ' Retorno' })).toBe(VIOLA_CHECK);
  });

  it('corpo até 50.000', async () => {
    expect(await erroAoCriar('modelo_texto', { corpo: 'x'.repeat(50_000) })).toBeNull();
    expect(await erroAoCriar('modelo_texto', { corpo: 'x'.repeat(50_001) })).toBe(VIOLA_CHECK);
  });

  it('nome único sem diferenciar maiúsculas entre os não arquivados', async () => {
    expect(await erroAoCriar('modelo_texto', { nome: 'PADRÃO' })).toBe(VIOLA_UNICO);
    expect(await erroAoCriar('modelo_texto', { nome: 'padrão', arquivado_em: 'now()' })).toBeNull();
  });

  it('arquivar é preencher arquivado_em (a app troca nome, corpo e arquivado_em)', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_column_privilege('app', 'modelo_texto', 'arquivado_em', 'UPDATE') as arquivado,
              has_column_privilege('app', 'modelo_texto', 'nome', 'UPDATE') as nome,
              has_column_privilege('app', 'modelo_texto', 'corpo', 'UPDATE') as corpo,
              has_column_privilege('app', 'modelo_texto', 'tipo', 'UPDATE') as tipo,
              has_column_privilege('app', 'modelo_texto', 'usuario_id', 'UPDATE') as dono`,
    );
    expect(privilegios).toEqual({
      arquivado: true,
      nome: true,
      corpo: true,
      tipo: false,
      dono: false,
    });
  });
});

describe('nada é apagado (EVO-07, ISO-03)', () => {
  it.each(TABELAS)('%s: a app não tem DELETE nem TRUNCATE', async (tabela) => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('app', $1, 'DELETE') as delete,
              has_table_privilege('app', $1, 'TRUNCATE') as truncate`,
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
    const comandos: Record<(typeof TABELAS)[number], [string, unknown[]]> = {
      evolucao: [
        `insert into evolucao (usuario_id, paciente_id, texto) values ($1, $2, 'x')`,
        [B, PACIENTE_B],
      ],
      evolucao_retificacao: [
        `insert into evolucao_retificacao (usuario_id, evolucao_id, seq, texto, motivo)
         values ($1, $2, 2, 'x', 'y')`,
        [B, EVOLUCAO_B],
      ],
      rascunho: [
        `insert into rascunho (usuario_id, tipo, ref, payload) values ($1, 'evolucao', 'r', '{}')`,
        [B],
      ],
      modelo_texto: [
        `insert into modelo_texto (usuario_id, tipo, nome, corpo) values ($1, 'evolucao', 'N', '')`,
        [B],
      ],
    };
    const [comando, parametros] = comandos[tabela];
    const codigo = await comoRole(
      banco.cliente,
      'app',
      () => codigoDoErro(() => banco.cliente.query(comando, parametros)),
      A,
    );
    expect(codigo).toBe(SEM_PERMISSAO_OU_RLS);
  });
});

describe('a app registra a evolução do próprio paciente', () => {
  it('cria evolução, rascunho e modelo e edita a evolução no dia', async () => {
    const resultado = await comoRole(
      banco.cliente,
      'app',
      async () => {
        const { rows } = await banco.cliente.query<{ id: string }>(
          `insert into evolucao (usuario_id, paciente_id, sessao_id, texto)
           values ($1, $2, $3, 'Evolução') returning id`,
          [A, PACIENTE_A, SESSAO_A2],
        );
        await banco.cliente.query(
          `insert into rascunho (usuario_id, tipo, ref, payload) values ($1, 'evolucao', $2, '{}')`,
          [A, SESSAO_A2],
        );
        await banco.cliente.query(
          `insert into modelo_texto (usuario_id, tipo, nome, corpo) values ($1, 'evolucao', 'Novo', 'c')`,
          [A],
        );
        return (
          await banco.cliente.query(
            `update evolucao set texto = 'Outra', row_version = row_version + 1 where id = $1`,
            [rows[0]!.id],
          )
        ).rowCount;
      },
      A,
    );
    expect(resultado).toBe(1);
  });
});
