import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T126 / PLANO-08, ISO-03 (ADR-005): migration 0012 cria as funções tarefas.* com que o webhook
// do Asaas (T129 a T131) e o cron (T137) localizam e mudam a assinatura sem a RLS do usuário.
// - tarefas.localizar_assinatura_asaas(assinatura, cliente): acha pelo id da assinatura no Asaas
//   e, sem ela, pelo id do cliente; devolve só usuario_id, status, periodo_fim e
//   vencimento_atraso da linha achada; id inexistente devolve nenhuma linha.
// - tarefas.mudar_estado_assinatura(usuario, status, periodo_fim, vencimento_atraso): aplica a
//   máquina de estados do PLANO-01 (a mesma do domínio, T125). Transição permitida muda; inválida
//   é ignorada (nada muda) e devolvida como 'transicao_invalida' para quem chama registrar; o
//   mesmo estado é 'mesmo_estado' (renovação de ativa só adianta periodo_fim, PLANO-08).
// - SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico; a app
//   executa as duas, backup_ro e PUBLIC não. A app continua sem UPDATE direto na assinatura.

const PARAMETRO_INVALIDO = '22023';
const DUPLICADO = '23505';
const SEM_PERMISSAO_OU_RLS = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';

const PERIODO_A = new Date('2026-11-10T03:00:00.000Z');
const PERIODO_B = new Date('2026-11-20T03:00:00.000Z');

type Estado = 'trial' | 'ativa' | 'atrasada' | 'cancelada' | 'free';
const ESTADOS: Estado[] = ['trial', 'ativa', 'atrasada', 'cancelada', 'free'];

// PLANO-01, texto da spec: trial → ativa ou free; ativa → atrasada ou cancelada; atrasada → ativa
// ou free; cancelada → free; free → ativa.
const PERMITIDAS: Record<Estado, Estado[]> = {
  trial: ['ativa', 'free'],
  ativa: ['atrasada', 'cancelada'],
  atrasada: ['ativa', 'free'],
  cancelada: ['free'],
  free: ['ativa'],
};

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0012');
  await banco.cliente.query(
    `insert into usuario (id, email, nome)
     values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B'), ($3, 'c@exemplo.com', 'C'),
            ($4, 'd@exemplo.com', 'D')`,
    [A, B, C, D],
  );
  await banco.cliente.query(
    `insert into assinatura
       (usuario_id, plano, status, asaas_customer_id, asaas_subscription_id, periodo_fim)
     values ($1, 'pro', 'ativa', 'cus_a', 'sub_a', $4),
            ($2, 'pro', 'ativa', 'cus_b', 'sub_b', $5),
            ($3, 'pro', 'trial', 'cus_c', null, $4),
            ($6, 'pro', 'ativa', 'cus_d', 'sub_d', $4)`,
    [A, B, C, PERIODO_A, PERIODO_B, D],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

interface Localizada {
  usuario_id: string;
  status: string;
  periodo_fim: Date;
  vencimento_atraso: Date | null;
}

const localizar = (assinatura: string | null, cliente: string | null) =>
  consultar<Localizada>('select * from tarefas.localizar_assinatura_asaas($1, $2)', [
    assinatura,
    cliente,
  ]);

interface Mudanca {
  resultado: string;
  status_anterior: string | null;
}

const mudar = async (
  usuario: string | null,
  status: string | null,
  periodoFim: Date | null = null,
  vencimentoAtraso: Date | null = null,
): Promise<Mudanca> =>
  (
    await consultar<Mudanca>('select * from tarefas.mudar_estado_assinatura($1, $2, $3, $4)', [
      usuario,
      status,
      periodoFim,
      vencimentoAtraso,
    ])
  )[0]!;

interface Linha {
  plano: string;
  status: string;
  periodo_fim: Date;
  vencimento_atraso: Date | null;
  atualizado_em: Date;
}

// Lida como superusuário (passa pela RLS), na transação corrente.
const linha = async (usuario: string): Promise<Linha> =>
  (
    await consultar<Linha>(
      `select plano, status, periodo_fim, vencimento_atraso, atualizado_em
       from assinatura where usuario_id = $1`,
      [usuario],
    )
  )[0]!;

// Põe a assinatura de `usuario` no estado `de` (superusuário), na transação corrente.
const colocarEm = (usuario: string, de: Estado, vencimento: Date | null = null) =>
  banco.cliente.query(
    `update assinatura set plano = $2, status = $3, periodo_fim = $4, vencimento_atraso = $5,
       atualizado_em = '2026-01-01T00:00:00Z'
     where usuario_id = $1`,
    [usuario, de === 'free' ? 'free' : 'pro', de, PERIODO_A, vencimento],
  );

// Roda `fn` numa transação desfeita: prepara como superusuário e chama como app, sem usuário.
async function comoApp<T>(preparar: () => Promise<unknown>, fn: () => Promise<T>): Promise<T> {
  await banco.cliente.query('begin');
  try {
    await preparar();
    await banco.cliente.query('set local role app');
    return await fn();
  } finally {
    await banco.cliente.query('rollback');
  }
}

const parametrosPara = (para: Estado): [Date | null, Date | null] =>
  para === 'ativa' ? [PERIODO_B, null] : para === 'atrasada' ? [null, PERIODO_B] : [null, null];

describe('catálogo: SECURITY DEFINER, search_path fixo, tipos e grants (ISO-03)', () => {
  const FUNCOES = {
    'tarefas.localizar_assinatura_asaas(text, text)':
      'p_asaas_subscription_id text, p_asaas_customer_id text',
    'tarefas.mudar_estado_assinatura(uuid, text, timestamptz, timestamptz)':
      'p_usuario_id uuid, p_status text, p_periodo_fim timestamp with time zone, p_vencimento_atraso timestamp with time zone',
  };

  it.each(Object.entries(FUNCOES))(
    '%s é do owner, definer, com search_path fixo e parâmetros tipados',
    async (assinatura, argumentos) => {
      expect(
        await consultar(
          `select pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer,
                  exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                          where c = 'search_path=pg_catalog, pg_temp') as search_path_fixo,
                  pg_get_function_identity_arguments(p.oid) as argumentos,
                  p.prosrc ~* '\\mexecute\\M' as sql_dinamico
           from pg_proc p where p.oid = $1::regprocedure`,
          [assinatura],
        ),
      ).toEqual([
        {
          dono: 'owner',
          definer: true,
          search_path_fixo: true,
          argumentos,
          sql_dinamico: false,
        },
      ]);
    },
  );

  it.each(Object.keys(FUNCOES))('%s: app executa; backup_ro e PUBLIC não', async (assinatura) => {
    expect(
      await consultar(
        `select has_function_privilege('app', $1::regprocedure, 'EXECUTE') as app,
                has_function_privilege('backup_ro', $1::regprocedure, 'EXECUTE') as backup_ro,
                exists (select 1 from aclexplode((select proacl from pg_proc
                                                  where oid = $1::regprocedure)) a
                        where a.grantee = 0) as public`,
        [assinatura],
      ),
    ).toEqual([{ app: true, backup_ro: false, public: false }]);
  });

  it('a app continua sem UPDATE, DELETE e TRUNCATE diretos na assinatura', async () => {
    expect(
      await consultar(
        `select has_any_column_privilege('app', 'assinatura', 'UPDATE') as update,
                has_table_privilege('app', 'assinatura', 'DELETE') as delete,
                has_table_privilege('app', 'assinatura', 'TRUNCATE') as truncate`,
      ),
    ).toEqual([{ update: false, delete: false, truncate: false }]);
  });

  it('id do Asaas é único por assinatura e por cliente', async () => {
    for (const [coluna, valor] of [
      ['asaas_subscription_id', 'sub_a'],
      ['asaas_customer_id', 'cus_a'],
    ])
      expect(
        await comoRole(banco.cliente, null, () =>
          codigoDoErro(() =>
            banco.cliente.query(`update assinatura set ${coluna} = $2 where usuario_id = $1`, [
              B,
              valor,
            ]),
          ),
        ),
        coluna,
      ).toBe(DUPLICADO);
  });
});

describe('localizar_assinatura_asaas: por id do Asaas, sem a RLS do usuário', () => {
  it('acha pelo id da assinatura, sem usuário na transação, só com as colunas necessárias', async () => {
    const achadas = await comoRole(banco.cliente, 'app', () => localizar('sub_a', null));
    expect(achadas).toEqual([
      { usuario_id: A, status: 'ativa', periodo_fim: PERIODO_A, vencimento_atraso: null },
    ]);
  });

  it('sem o id da assinatura (ou com um que não existe), acha pelo id do cliente', async () => {
    const porCliente = await comoRole(banco.cliente, 'app', () => localizar(null, 'cus_c'));
    const assinaturaDesconhecida = await comoRole(banco.cliente, 'app', () =>
      localizar('sub_nova', 'cus_c'),
    );
    expect(porCliente.map((l) => [l.usuario_id, l.status])).toEqual([[C, 'trial']]);
    expect(assinaturaDesconhecida.map((l) => l.usuario_id)).toEqual([C]);
  });

  it('o id da assinatura vale mais que o do cliente', async () => {
    const achadas = await comoRole(banco.cliente, 'app', () => localizar('sub_a', 'cus_b'));
    expect(achadas.map((l) => l.usuario_id)).toEqual([A]);
  });

  it('id inexistente (ou nenhum id) não devolve linha', async () => {
    const ids: [string | null, string | null][] = [
      ['sub_x', null],
      [null, 'cus_x'],
      ['sub_x', 'cus_x'],
      [null, null],
    ];
    for (const [assinatura, cliente] of ids)
      expect(
        await comoRole(banco.cliente, 'app', () => localizar(assinatura, cliente)),
        `${assinatura} ${cliente}`,
      ).toEqual([]);
  });

  it('com outro usuário na transação, acha a do Asaas e nada mais', async () => {
    const achadas = await comoRole(banco.cliente, 'app', () => localizar('sub_a', null), B);
    expect(achadas.map((l) => l.usuario_id)).toEqual([A]);
  });
});

describe('mudar_estado_assinatura: máquina de estados do PLANO-01', () => {
  const pares = ESTADOS.flatMap((de) => ESTADOS.map((para) => [de, para] as const));

  it.each(pares)('%s → %s', async (de, para) => {
    const [periodo, vencimento] = parametrosPara(para);
    const vencimentoDe = de === 'atrasada' ? PERIODO_A : null;
    const { mudanca, depois } = await comoApp(
      () => colocarEm(A, de, vencimentoDe),
      async () => {
        const mudanca = await mudar(A, para, periodo, vencimento);
        await banco.cliente.query('reset role');
        return { mudanca, depois: await linha(A) };
      },
    );
    const esperado =
      de === para
        ? 'mesmo_estado'
        : PERMITIDAS[de].includes(para)
          ? 'permitida'
          : 'transicao_invalida';
    expect(mudanca).toEqual({ resultado: esperado, status_anterior: de });
    if (esperado === 'permitida') {
      expect(depois.status).toBe(para);
      expect(depois.plano).toBe(para === 'free' ? 'free' : 'pro');
    } else if (esperado === 'transicao_invalida') {
      // Ignorada: nada muda, nem atualizado_em.
      expect(depois).toEqual({
        plano: de === 'free' ? 'free' : 'pro',
        status: de,
        periodo_fim: PERIODO_A,
        vencimento_atraso: vencimentoDe,
        atualizado_em: new Date('2026-01-01T00:00:00Z'),
      });
    }
  });
});

describe('mudar_estado_assinatura: periodo_fim e vencimento_atraso', () => {
  const aplicar = (
    de: Estado,
    para: Estado,
    periodo: Date | null,
    vencimento: Date | null,
    vencimentoDe: Date | null = null,
  ) =>
    comoApp(
      () => colocarEm(A, de, vencimentoDe),
      async () => {
        const mudanca = await mudar(A, para, periodo, vencimento);
        await banco.cliente.query('reset role');
        const { plano, status, periodo_fim, vencimento_atraso } = await linha(A);
        const resto = { plano, status, periodo_fim, vencimento_atraso };
        // Comparado no banco: o Date do JS perde os microssegundos de now().
        const [{ agora }] = (await consultar<{ agora: boolean }>(
          'select atualizado_em = now() as agora from assinatura where usuario_id = $1',
          [A],
        )) as [{ agora: boolean }];
        return { mudanca, ...resto, atualizado_agora: agora };
      },
    );

  it('PLANO-08: pagamento no trial leva a ativa com periodo_fim no próximo vencimento', async () => {
    expect(await aplicar('trial', 'ativa', PERIODO_B, null)).toEqual({
      mudanca: { resultado: 'permitida', status_anterior: 'trial' },
      plano: 'pro',
      status: 'ativa',
      periodo_fim: PERIODO_B,
      vencimento_atraso: null,
      atualizado_agora: true,
    });
  });

  it('pagamento em atrasada volta a ativa e limpa vencimento_atraso', async () => {
    expect(await aplicar('atrasada', 'ativa', PERIODO_B, null, PERIODO_A)).toMatchObject({
      mudanca: { resultado: 'permitida' },
      status: 'ativa',
      periodo_fim: PERIODO_B,
      vencimento_atraso: null,
    });
  });

  it('free volta a ativa no plano pro', async () => {
    expect(await aplicar('free', 'ativa', PERIODO_B, null)).toMatchObject({
      plano: 'pro',
      status: 'ativa',
      periodo_fim: PERIODO_B,
    });
  });

  it('cobrança vencida leva a atrasada com vencimento_atraso e mantém periodo_fim', async () => {
    expect(await aplicar('ativa', 'atrasada', null, PERIODO_B)).toEqual({
      mudanca: { resultado: 'permitida', status_anterior: 'ativa' },
      plano: 'pro',
      status: 'atrasada',
      periodo_fim: PERIODO_A,
      vencimento_atraso: PERIODO_B,
      atualizado_agora: true,
    });
  });

  it('cancelar mantém periodo_fim (Pro até o fim do período)', async () => {
    expect(await aplicar('ativa', 'cancelada', null, null)).toMatchObject({
      plano: 'pro',
      status: 'cancelada',
      periodo_fim: PERIODO_A,
      vencimento_atraso: null,
    });
  });

  it('cair para free troca o plano, mantém periodo_fim e limpa vencimento_atraso', async () => {
    expect(await aplicar('atrasada', 'free', null, null, PERIODO_A)).toMatchObject({
      plano: 'free',
      status: 'free',
      periodo_fim: PERIODO_A,
      vencimento_atraso: null,
    });
  });

  it('renovação de ativa adianta periodo_fim e nunca o faz regredir', async () => {
    expect(await aplicar('ativa', 'ativa', PERIODO_B, null)).toMatchObject({
      mudanca: { resultado: 'mesmo_estado', status_anterior: 'ativa' },
      status: 'ativa',
      periodo_fim: PERIODO_B,
    });
    expect(await aplicar('ativa', 'ativa', new Date('2026-10-01T03:00:00Z'), null)).toMatchObject({
      mudanca: { resultado: 'mesmo_estado' },
      periodo_fim: PERIODO_A,
    });
  });

  it('nova cobrança vencida em atrasada não reinicia a tolerância', async () => {
    expect(await aplicar('atrasada', 'atrasada', null, PERIODO_B, PERIODO_A)).toMatchObject({
      mudanca: { resultado: 'mesmo_estado' },
      vencimento_atraso: PERIODO_A,
      atualizado_agora: false,
    });
  });

  it('recusa parâmetros incoerentes ou fora do tipo', async () => {
    const casos: [string | null, string | null, Date | null, Date | null][] = [
      [A, 'ativa', null, null], // ativa exige periodo_fim
      [A, 'atrasada', null, null], // atrasada exige vencimento_atraso
      [A, 'cancelada', null, PERIODO_B], // vencimento_atraso só com atrasada
      [A, 'pendente', null, null],
      [A, null, null, null],
      [null, 'free', null, null],
    ];
    for (const [usuario, status, periodo, vencimento] of casos)
      expect(
        await comoRole(banco.cliente, 'app', () =>
          codigoDoErro(() => mudar(usuario, status, periodo, vencimento)),
        ),
        JSON.stringify([usuario, status, periodo, vencimento]),
      ).toBe(PARAMETRO_INVALIDO);
  });

  it('usuário sem assinatura devolve inexistente e não cria nada', async () => {
    const { mudanca, n } = await comoRole(banco.cliente, 'app', async () => {
      const mudanca = await mudar(INEXISTENTE, 'free');
      await banco.cliente.query('reset role');
      const [{ n }] = (await consultar<{ n: number }>(
        'select count(*)::int as n from assinatura where usuario_id = $1',
        [INEXISTENTE],
      )) as [{ n: number }];
      return { mudanca, n };
    });
    expect(mudanca).toEqual({ resultado: 'inexistente', status_anterior: null });
    expect(n).toBe(0);
  });
});

describe('isolamento (ISO-01, ISO-03)', () => {
  it('mudar a assinatura de A não toca a de B', async () => {
    const antes = await linha(B);
    const depois = await comoApp(
      async () => {},
      async () => {
        await mudar(A, 'atrasada', null, PERIODO_B);
        await banco.cliente.query('reset role');
        return linha(B);
      },
    );
    expect(depois).toEqual(antes);
  });

  it('depois das funções, a app continua sem ver assinatura alheia na transação', async () => {
    const { visiveis, contexto } = await comoRole(
      banco.cliente,
      'app',
      async () => {
        await localizar('sub_a', null);
        await mudar(A, 'cancelada');
        const visiveis = await consultar<{ usuario_id: string }>(
          'select usuario_id from assinatura order by 1',
        );
        const [{ contexto }] = (await consultar<{ contexto: string | null }>(
          "select nullif(current_setting('app.tarefa_assinatura', true), '') as contexto",
        )) as [{ contexto: string | null }];
        return { visiveis, contexto };
      },
      B,
    );
    expect(visiveis.map((l) => l.usuario_id)).toEqual([B]);
    expect(contexto).toBeNull();
  });

  it('a app não ganha acesso a assinatura alheia ligando o contexto das tarefas', async () => {
    const { visiveis, atualizar } = await comoRole(banco.cliente, 'app', async () => {
      await banco.cliente.query("select set_config('app.tarefa_assinatura', 'on', true)");
      const visiveis = await consultar('select usuario_id from assinatura');
      const atualizar = await codigoDoErro(() =>
        banco.cliente.query("update assinatura set status = 'free' where usuario_id = $1", [A]),
      );
      return { visiveis, atualizar };
    });
    expect(visiveis).toEqual([]);
    expect(atualizar).toBe(SEM_PERMISSAO_OU_RLS);
  });

  it('owner sem estar numa das funções continua sem ver linha', async () => {
    expect(
      await comoRole(banco.cliente, 'owner', () => consultar('select usuario_id from assinatura')),
    ).toEqual([]);
  });

  it('mudanças simultâneas na mesma assinatura são serializadas', async () => {
    const [c1, c2] = [
      new pg.Client({ connectionString: banco.url }),
      new pg.Client({ connectionString: banco.url }),
    ];
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      const chamar = (c: pg.Client, status: string, vencimento: Date | null) =>
        c.query<Mudanca>('select * from tarefas.mudar_estado_assinatura($1, $2, null, $3)', [
          D,
          status,
          vencimento,
        ]);
      await c1.query('begin');
      await c1.query('set local role app');
      const primeira = await chamar(c1, 'atrasada', PERIODO_B);
      await c2.query('begin');
      await c2.query('set local role app');
      const segunda = chamar(c2, 'cancelada', null);
      await c1.query('commit');
      const resultado = await segunda;
      await c2.query('commit');
      expect(primeira.rows).toEqual([{ resultado: 'permitida', status_anterior: 'ativa' }]);
      expect(resultado.rows).toEqual([
        { resultado: 'transicao_invalida', status_anterior: 'atrasada' },
      ]);
      expect((await linha(D)).status).toBe('atrasada');
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });
});
