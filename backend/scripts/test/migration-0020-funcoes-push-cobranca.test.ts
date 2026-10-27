import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T146 / PUSH-04, PUSH-05, ISO-03 (ADR-005, ADR-010): migration 0020 cria
// tarefas.listar_eventos_cobranca_para_aviso(desde, ate, limite), com que o cron acha, entre
// todos os profissionais, os eventos de cobrança do Asaas já processados (webhook_evento com
// processado_em em (desde, ate] e o profissional achado) que pedem push: PAYMENT_CREATED vira
// 'cobranca_gerada', PAYMENT_RECEIVED e PAYMENT_CONFIRMED viram 'pagamento_confirmado' e
// PAYMENT_OVERDUE vira 'cobranca_vencida', com ref = id do pagamento. Um por (profissional, tipo,
// pagamento), só de quem tem push ativo e ainda sem registro em notificacao_enviada. Devolve só
// usuario_id, tipo e ref, até `limite`, pela ordem de processamento.
// SECURITY DEFINER do owner, search_path fixo; a app executa, backup_ro e PUBLIC não; a leitura
// liberada ao owner vale só dentro da função.

const PARAMETRO_INVALIDO = '22023';
const DESDE = new Date('2026-11-09T17:00:00.000Z');
const ATE = new Date('2026-11-10T17:00:00.000Z');
const MIN = 60_000;

let banco: BancoDeTeste;
let a: string;
let b: string;
let semPush: string;

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

async function usuario(email: string): Promise<string> {
  const [u] = await consultar<{ id: string }>(
    `insert into usuario (email, nome) values ($1, 'Pessoa') returning id`,
    [email],
  );
  return u!.id;
}

beforeAll(async () => {
  banco = await criarBancoMigrado('m0020');
  a = await usuario('a@exemplo.com');
  b = await usuario('b@exemplo.com');
  semPush = await usuario('c@exemplo.com');
  await consultar(
    `insert into push_subscription (usuario_id, endpoint, p256dh, auth)
     values ($1, 'https://push.exemplo.com/a1', 'k', 'a'),
            ($1, 'https://push.exemplo.com/a2', 'k', 'a'),
            ($2, 'https://push.exemplo.com/b', 'k', 'a')`,
    [a, b],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

beforeEach(async () => {
  await banco.cliente.query('delete from notificacao_enviada');
  await banco.cliente.query('delete from webhook_evento');
});

let seq = 0;
async function evento(
  usuarioId: string | null,
  tipo: string,
  pagamento: unknown,
  processadoEm: Date | null = new Date(ATE.getTime() - MIN),
) {
  seq += 1;
  const payload = { id: `evt_${seq}`, event: tipo, payment: { id: pagamento } };
  await consultar(
    `insert into webhook_evento (event_id, usuario_id, tipo, payload, processado_em)
     values ($1, $2, $3, $4, $5)`,
    [payload.id, usuarioId, tipo, JSON.stringify(payload), processadoEm],
  );
}

type Linha = { usuario_id: string; tipo: string; ref: string };

const listar = (desde: Date | null = DESDE, ate: Date | null = ATE, limite: number | null = 10) =>
  comoRole(banco.cliente, 'app', () =>
    consultar<Linha>('select * from tarefas.listar_eventos_cobranca_para_aviso($1, $2, $3)', [
      desde,
      ate,
      limite,
    ]),
  );

describe('listar_eventos_cobranca_para_aviso (PUSH-04)', () => {
  it('traduz cada tipo de evento do Asaas no tipo de aviso, com o id do pagamento', async () => {
    await evento(a, 'PAYMENT_CREATED', 'pay_1', new Date(ATE.getTime() - 4 * MIN));
    await evento(a, 'PAYMENT_RECEIVED', 'pay_2', new Date(ATE.getTime() - 3 * MIN));
    await evento(a, 'PAYMENT_CONFIRMED', 'pay_3', new Date(ATE.getTime() - 2 * MIN));
    await evento(a, 'PAYMENT_OVERDUE', 'pay_4', new Date(ATE.getTime() - MIN));
    expect(await listar()).toEqual([
      { usuario_id: a, tipo: 'cobranca_gerada', ref: 'pay_1' },
      { usuario_id: a, tipo: 'pagamento_confirmado', ref: 'pay_2' },
      { usuario_id: a, tipo: 'pagamento_confirmado', ref: 'pay_3' },
      { usuario_id: a, tipo: 'cobranca_vencida', ref: 'pay_4' },
    ]);
  });

  it('recebido e confirmado do mesmo pagamento, ou evento repetido, viram uma linha só', async () => {
    await evento(a, 'PAYMENT_RECEIVED', 'pay_1');
    await evento(a, 'PAYMENT_CONFIRMED', 'pay_1');
    await evento(a, 'PAYMENT_CREATED', 'pay_2');
    await evento(a, 'PAYMENT_CREATED', 'pay_2');
    expect(await listar()).toHaveLength(2);
  });

  it('a janela é (desde, ate]: desde não entra, ate entra', async () => {
    await evento(a, 'PAYMENT_CREATED', 'no_desde', DESDE);
    await evento(a, 'PAYMENT_CREATED', 'no_ate', ATE);
    await evento(a, 'PAYMENT_CREATED', 'depois', new Date(ATE.getTime() + 1));
    expect((await listar()).map((l) => l.ref)).toEqual(['no_ate']);
  });

  it('evento não processado, sem profissional ou de outro tipo fica de fora', async () => {
    await evento(a, 'PAYMENT_CREATED', 'pay_1', null);
    await evento(null, 'PAYMENT_CREATED', 'pay_2');
    for (const tipo of ['PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'SUBSCRIPTION_CREATED'])
      await evento(a, tipo, `x_${tipo}`);
    expect(await listar()).toEqual([]);
  });

  it('pagamento sem id em texto fica de fora', async () => {
    await evento(a, 'PAYMENT_CREATED', 123);
    await evento(a, 'PAYMENT_CREATED', null);
    await evento(a, 'PAYMENT_CREATED', '');
    expect(await listar()).toEqual([]);
  });

  it('só de quem tem push ativo', async () => {
    await evento(semPush, 'PAYMENT_CREATED', 'pay_1');
    expect(await listar()).toEqual([]);
  });

  it('uma vez por evento: o já avisado sai da lista; outro tipo com a mesma ref não conta', async () => {
    await evento(a, 'PAYMENT_CREATED', 'pay_1');
    await evento(a, 'PAYMENT_OVERDUE', 'pay_1');
    await evento(b, 'PAYMENT_CREATED', 'pay_1');
    await consultar(
      `insert into notificacao_enviada (usuario_id, tipo, ref) values ($1, 'cobranca_gerada', 'pay_1')`,
      [a],
    );
    expect(await listar()).toEqual(
      expect.arrayContaining([
        { usuario_id: a, tipo: 'cobranca_vencida', ref: 'pay_1' },
        { usuario_id: b, tipo: 'cobranca_gerada', ref: 'pay_1' },
      ]),
    );
    expect(await listar()).toHaveLength(2);
  });

  it('respeita o limite, pela ordem de processamento', async () => {
    await evento(b, 'PAYMENT_CREATED', 'segundo', new Date(ATE.getTime() - 2 * MIN));
    await evento(a, 'PAYMENT_CREATED', 'primeiro', new Date(ATE.getTime() - 3 * MIN));
    await evento(a, 'PAYMENT_CREATED', 'terceiro', new Date(ATE.getTime() - MIN));
    expect((await listar(DESDE, ATE, 2)).map((l) => l.ref)).toEqual(['primeiro', 'segundo']);
  });

  it('recusa janela nula ou invertida e limite fora de 1 a 1000', async () => {
    for (const [desde, ate, limite] of [
      [null, ATE, 10],
      [DESDE, null, 10],
      [ATE, DESDE, 10],
      [DESDE, ATE, null],
      [DESDE, ATE, 0],
      [DESDE, ATE, 1001],
    ] as const)
      expect(await codigoDoErro(() => listar(desde, ate, limite))).toBe(PARAMETRO_INVALIDO);
  });
});

describe('segurança da função (ISO-03, ADR-005)', () => {
  it('é SECURITY DEFINER do owner com search_path fixo; a app executa, backup_ro não', async () => {
    expect(
      await consultar(
        `select pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer,
                exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                        where c like 'search_path=%') as search_path_fixo,
                has_function_privilege('app', p.oid, 'EXECUTE') as app,
                has_function_privilege('backup_ro', p.oid, 'EXECUTE') as backup_ro
         from pg_proc p
         where p.oid = 'tarefas.listar_eventos_cobranca_para_aviso(timestamptz, timestamptz, integer)'::regprocedure`,
      ),
    ).toEqual([
      { dono: 'owner', definer: true, search_path_fixo: true, app: true, backup_ro: false },
    ]);
  });

  it('fora da função, nem a app com a variável ligada nem o owner leem evento alheio', async () => {
    await evento(a, 'PAYMENT_CREATED', 'pay_1');
    const ver = () => consultar(`select 1 from webhook_evento`);
    expect(
      await comoRole(banco.cliente, 'app', async () => {
        await banco.cliente.query("select set_config('app.tarefa_push', 'on', true)");
        return ver();
      }),
    ).toEqual([]);
    expect(await comoRole(banco.cliente, 'owner', ver)).toEqual([]);
  });
});
