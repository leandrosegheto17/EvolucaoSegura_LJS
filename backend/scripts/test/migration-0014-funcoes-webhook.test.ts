import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T169 / PLANO-06, PLANO-07, ISO-03 (ADR-005): migration 0014 cria as funções tarefas.* com que o
// webhook do Asaas grava o evento antes de processar e o marca como processado (a app só lê
// webhook_evento).
// - gravar_webhook_evento(event_id, tipo, payload): evento novo devolve 'novo'; event_id repetido
//   devolve 'repetido' sem alterar o registro.
// - marcar_webhook_processado(event_id, usuario_id): só em evento existente e só uma vez
//   ('marcado'; depois 'ja_processado' sem mudar nada; 'inexistente' sem criar nada).
// - SECURITY DEFINER do owner, search_path fixo, parâmetros tipados; app executa, evolucao_backup_ro e
//   PUBLIC não.

const PARAMETRO_INVALIDO = '22023';
const SEM_PERMISSAO_OU_RLS = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const EVENTO = 'evt_d26e303b238e509335ac9ba210e51b0f&23477397';
const PAYLOAD = { id: EVENTO, event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } };

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0014');
  await banco.cliente.query(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

const gravar = async (eventId: string | null, tipo: string | null, payload: unknown) =>
  (
    await consultar<{ r: string }>('select tarefas.gravar_webhook_evento($1, $2, $3) as r', [
      eventId,
      tipo,
      payload === null ? null : JSON.stringify(payload),
    ])
  )[0]!.r;

const marcar = async (eventId: string | null, usuario: string | null) =>
  (
    await consultar<{ r: string }>('select tarefas.marcar_webhook_processado($1, $2) as r', [
      eventId,
      usuario,
    ])
  )[0]!.r;

// Eventos lidos como superusuário, na transação corrente.
const eventos = () =>
  consultar<{
    event_id: string;
    tipo: string;
    payload: unknown;
    usuario_id: string | null;
    processado_agora: boolean | null;
    processado_em: Date | null;
  }>(
    `select event_id, tipo, payload, usuario_id, processado_em = now() as processado_agora,
            processado_em
     from webhook_evento order by id`,
  );

// Roda `fn` como app sem usuário, numa transação desfeita; devolve o resultado e os eventos.
const comoApp = <T>(fn: () => Promise<T>) =>
  comoRole(banco.cliente, 'evolucao_app', async () => {
    const resultado = await fn();
    await banco.cliente.query('reset role');
    return { resultado, eventos: await eventos() };
  });

describe('catálogo: SECURITY DEFINER, search_path fixo, tipos e grants (ISO-03)', () => {
  const FUNCOES = {
    'tarefas.gravar_webhook_evento(text, text, jsonb)':
      'p_event_id text, p_tipo text, p_payload jsonb',
    'tarefas.marcar_webhook_processado(text, uuid)': 'p_event_id text, p_usuario_id uuid',
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
          dono: 'evolucao_owner',
          definer: true,
          search_path_fixo: true,
          argumentos,
          sql_dinamico: false,
        },
      ]);
    },
  );

  it.each(Object.keys(FUNCOES))(
    '%s: app executa; evolucao_backup_ro e PUBLIC não',
    async (assinatura) => {
      expect(
        await consultar(
          `select has_function_privilege('evolucao_app', $1::regprocedure, 'EXECUTE') as app,
                has_function_privilege('evolucao_backup_ro', $1::regprocedure, 'EXECUTE') as evolucao_backup_ro,
                exists (select 1 from aclexplode((select proacl from pg_proc
                                                  where oid = $1::regprocedure)) a
                        where a.grantee = 0) as public`,
          [assinatura],
        ),
      ).toEqual([{ app: true, evolucao_backup_ro: false, public: false }]);
    },
  );

  it('a app continua sem INSERT, UPDATE, DELETE e TRUNCATE diretos em webhook_evento', async () => {
    expect(
      await consultar(
        `select has_table_privilege('evolucao_app', 'webhook_evento', 'INSERT') as insert,
                has_any_column_privilege('evolucao_app', 'webhook_evento', 'UPDATE') as update,
                has_table_privilege('evolucao_app', 'webhook_evento', 'DELETE') as delete,
                has_table_privilege('evolucao_app', 'webhook_evento', 'TRUNCATE') as truncate`,
      ),
    ).toEqual([{ insert: false, update: false, delete: false, truncate: false }]);
  });
});

describe('gravar_webhook_evento (PLANO-07)', () => {
  it('evento novo devolve "novo" e grava tipo e payload, sem usuário e sem processado_em', async () => {
    const { resultado, eventos } = await comoApp(() => gravar(EVENTO, 'PAYMENT_RECEIVED', PAYLOAD));
    expect(resultado).toBe('novo');
    expect(eventos).toEqual([
      {
        event_id: EVENTO,
        tipo: 'PAYMENT_RECEIVED',
        payload: PAYLOAD,
        usuario_id: null,
        processado_agora: null,
        processado_em: null,
      },
    ]);
  });

  it('event_id repetido devolve "repetido" sem alterar o registro', async () => {
    const { resultado, eventos } = await comoApp(async () => {
      await gravar(EVENTO, 'PAYMENT_RECEIVED', PAYLOAD);
      await marcar(EVENTO, A);
      return gravar(EVENTO, 'PAYMENT_OVERDUE', { outro: true });
    });
    expect(resultado).toBe('repetido');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: 'PAYMENT_RECEIVED',
      payload: PAYLOAD,
      usuario_id: A,
      processado_agora: true,
    });
  });

  it('o id inteiro do evento distingue eventos com o mesmo hash', async () => {
    const { resultado, eventos } = await comoApp(async () => {
      await gravar(EVENTO, 'PAYMENT_RECEIVED', PAYLOAD);
      return gravar(EVENTO.replace('23477397', '23477402'), 'PAYMENT_RECEIVED', PAYLOAD);
    });
    expect(resultado).toBe('novo');
    expect(eventos).toHaveLength(2);
  });

  it('parâmetro ausente recusa com 22023', async () => {
    const casos: [string | null, string | null, unknown][] = [
      [null, 'PAYMENT_RECEIVED', PAYLOAD],
      ['', 'PAYMENT_RECEIVED', PAYLOAD],
      [EVENTO, null, PAYLOAD],
      [EVENTO, 'PAYMENT_RECEIVED', null],
    ];
    for (const [eventId, tipo, payload] of casos)
      expect(
        await comoRole(banco.cliente, 'evolucao_app', () =>
          codigoDoErro(() => gravar(eventId, tipo, payload)),
        ),
        JSON.stringify([eventId, tipo]),
      ).toBe(PARAMETRO_INVALIDO);
  });

  it('entregas simultâneas do mesmo evento: uma "novo", a outra "repetido"', async () => {
    const [c1, c2] = [
      new pg.Client({ connectionString: banco.url }),
      new pg.Client({ connectionString: banco.url }),
    ];
    await Promise.all([c1.connect(), c2.connect()]);
    const id = `evt_simultaneo&${Date.now()}`;
    const chamar = (c: pg.Client) =>
      c.query<{ r: string }>(
        "select tarefas.gravar_webhook_evento($1, 'PAYMENT_RECEIVED', '{}') as r",
        [id],
      );
    try {
      await c1.query('begin');
      await c1.query('set local role evolucao_app');
      const primeira = await chamar(c1);
      await c2.query('begin');
      await c2.query('set local role evolucao_app');
      const segunda = chamar(c2);
      await c1.query('commit');
      const resultado = await segunda;
      await c2.query('commit');
      expect([primeira.rows[0]!.r, resultado.rows[0]!.r]).toEqual(['novo', 'repetido']);
    } finally {
      await banco.cliente.query('delete from webhook_evento where event_id = $1', [id]);
      await Promise.all([c1.end(), c2.end()]);
    }
  });
});

describe('marcar_webhook_processado', () => {
  it('marca processado_em e o usuário em evento existente', async () => {
    const { resultado, eventos } = await comoApp(async () => {
      await gravar(EVENTO, 'PAYMENT_RECEIVED', PAYLOAD);
      return marcar(EVENTO, A);
    });
    expect(resultado).toBe('marcado');
    expect(eventos).toMatchObject([{ event_id: EVENTO, usuario_id: A, processado_agora: true }]);
  });

  it('evento sem profissional achado é marcado com usuário nulo', async () => {
    const { resultado, eventos } = await comoApp(async () => {
      await gravar(EVENTO, 'PAYMENT_RECEIVED', PAYLOAD);
      return marcar(EVENTO, null);
    });
    expect(resultado).toBe('marcado');
    expect(eventos).toMatchObject([{ usuario_id: null, processado_agora: true }]);
  });

  it('só uma vez: a segunda devolve "ja_processado" e não muda nada', async () => {
    await banco.cliente.query('begin');
    try {
      await banco.cliente.query(
        `insert into webhook_evento (event_id, usuario_id, tipo, payload, processado_em)
         values ($1, $2, 'PAYMENT_RECEIVED', '{}', '2026-10-27T14:00:00Z')`,
        [EVENTO, A],
      );
      await banco.cliente.query('set local role evolucao_app');
      const resultado = await marcar(EVENTO, B);
      await banco.cliente.query('reset role');
      expect(resultado).toBe('ja_processado');
      expect(await eventos()).toMatchObject([
        { usuario_id: A, processado_em: new Date('2026-10-27T14:00:00Z') },
      ]);
    } finally {
      await banco.cliente.query('rollback');
    }
  });

  it('evento inexistente devolve "inexistente" e não cria nada', async () => {
    const { resultado, eventos } = await comoApp(() => marcar('evt_nunca&1', A));
    expect(resultado).toBe('inexistente');
    expect(eventos).toEqual([]);
  });

  it('event_id ausente recusa com 22023', async () => {
    for (const eventId of [null, ''])
      expect(
        await comoRole(banco.cliente, 'evolucao_app', () => codigoDoErro(() => marcar(eventId, A))),
      ).toBe(PARAMETRO_INVALIDO);
  });
});

describe('isolamento (ISO-01, ISO-03)', () => {
  it('depois de marcado, o evento fica visível só ao profissional dele', async () => {
    await banco.cliente.query('begin');
    try {
      await banco.cliente.query('set local role evolucao_app');
      await gravar(EVENTO, 'PAYMENT_RECEIVED', PAYLOAD);
      await marcar(EVENTO, A);
      const visiveis = async (usuario: string) => {
        await banco.cliente.query("select set_config('app.usuario_id', $1, true)", [usuario]);
        return (await consultar<{ event_id: string }>('select event_id from webhook_evento')).map(
          (l) => l.event_id,
        );
      };
      expect(await visiveis(A)).toEqual([EVENTO]);
      expect(await visiveis(B)).toEqual([]);
    } finally {
      await banco.cliente.query('rollback');
    }
  });

  it('a app não ganha acesso ligando o contexto das tarefas', async () => {
    const { visiveis, inserir } = await comoRole(banco.cliente, 'evolucao_app', async () => {
      await banco.cliente.query("select set_config('app.tarefa_webhook', 'on', true)");
      await gravar(EVENTO, 'PAYMENT_RECEIVED', PAYLOAD);
      const visiveis = await consultar('select event_id from webhook_evento');
      const inserir = await codigoDoErro(() =>
        banco.cliente.query(
          "insert into webhook_evento (event_id, tipo, payload) values ('evt_x', 'X', '{}')",
        ),
      );
      return { visiveis, inserir };
    });
    expect(visiveis).toEqual([]);
    expect(inserir).toBe(SEM_PERMISSAO_OU_RLS);
  });

  it('depois das funções, o contexto das tarefas fica desligado na transação', async () => {
    const contexto = await comoRole(banco.cliente, 'evolucao_app', async () => {
      await gravar(EVENTO, 'PAYMENT_RECEIVED', PAYLOAD);
      await marcar(EVENTO, A);
      return (
        await consultar<{ c: string | null }>(
          "select nullif(current_setting('app.tarefa_webhook', true), '') as c",
        )
      )[0]!.c;
    });
    expect(contexto).toBeNull();
  });
});
