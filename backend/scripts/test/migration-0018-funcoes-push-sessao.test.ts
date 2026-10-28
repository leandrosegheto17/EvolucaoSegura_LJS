import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T144 / PUSH-02, PUSH-05, ISO-03 (ADR-005, ADR-010): migration 0018 cria
// tarefas.listar_sessoes_para_aviso(de, ate, limite), com que o cron acha, entre todos os
// profissionais, as sessões `agendada` com início em [de, ate] (os dois inclusive) cujo
// profissional tem push ativo e que ainda não receberam o aviso 'sessao_proxima'. Devolve só
// usuario_id, sessao_id e inicio (nada do paciente), até `limite`, pela ordem de início.
// SECURITY DEFINER do owner, search_path fixo; a app executa, evolucao_backup_ro e PUBLIC não; a leitura
// liberada ao owner vale só dentro da função.

const PARAMETRO_INVALIDO = '22023';
const DE = new Date('2026-11-10T16:55:00.000Z');
const ATE = new Date('2026-11-10T17:00:00.000Z');
const MIN = 60_000;

let banco: BancoDeTeste;
let a: string;
let b: string;
let semPush: string;
let pacienteA: string;
let pacienteB: string;
let pacienteSemPush: string;

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

async function usuarioComPaciente(email: string): Promise<[string, string]> {
  const [u] = await consultar<{ id: string }>(
    `insert into usuario (email, nome) values ($1, 'Pessoa') returning id`,
    [email],
  );
  const [p] = await consultar<{ id: string }>(
    `insert into paciente (usuario_id, nome) values ($1, 'Joana Paciente') returning id`,
    [u!.id],
  );
  return [u!.id, p!.id];
}

beforeAll(async () => {
  banco = await criarBancoMigrado('m0018');
  [a, pacienteA] = await usuarioComPaciente('a@exemplo.com');
  [b, pacienteB] = await usuarioComPaciente('b@exemplo.com');
  [semPush, pacienteSemPush] = await usuarioComPaciente('c@exemplo.com');
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
  await banco.cliente.query('delete from sessao_atendimento');
});

async function sessao(
  usuario: string,
  paciente: string,
  inicio: Date,
  status = 'agendada',
): Promise<string> {
  const [linha] = await consultar<{ id: string }>(
    `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim, status)
     values ($1, $2, $3, $4, $5) returning id`,
    [usuario, paciente, inicio, new Date(inicio.getTime() + 50 * MIN), status],
  );
  return linha!.id;
}

const listar = (de: Date | null = DE, ate: Date | null = ATE, limite: number | null = 10) =>
  comoRole(banco.cliente, 'evolucao_app', () =>
    consultar<{ usuario_id: string; sessao_id: string; inicio: Date }>(
      'select * from tarefas.listar_sessoes_para_aviso($1, $2, $3)',
      [de, ate, limite],
    ),
  );

describe('listar_sessoes_para_aviso (PUSH-02)', () => {
  it('devolve a sessão agendada do intervalo, só com usuario_id, sessao_id e inicio', async () => {
    const id = await sessao(a, pacienteA, ATE);
    expect(await listar()).toEqual([{ usuario_id: a, sessao_id: id, inicio: ATE }]);
  });

  it('os dois limites do intervalo são inclusive; 1 ms fora não entra', async () => {
    const noInicio = await sessao(a, pacienteA, DE);
    const noFim = await sessao(b, pacienteB, ATE);
    await sessao(a, pacienteA, new Date(DE.getTime() - 1));
    await sessao(b, pacienteB, new Date(ATE.getTime() + 1));
    expect((await listar()).map((l) => l.sessao_id)).toEqual([noInicio, noFim]);
  });

  it('só sessões agendadas', async () => {
    for (const status of ['realizada', 'faltou', 'cancelada', 'remarcada'])
      await sessao(a, pacienteA, ATE, status);
    expect(await listar()).toEqual([]);
  });

  it('só de quem tem push ativo', async () => {
    await sessao(semPush, pacienteSemPush, ATE);
    expect(await listar()).toEqual([]);
  });

  it('uma vez por sessão: a sessão já avisada sai da lista', async () => {
    const avisada = await sessao(a, pacienteA, ATE);
    const outra = await sessao(b, pacienteB, ATE);
    await consultar(
      `insert into notificacao_enviada (usuario_id, tipo, ref) values ($1, 'sessao_proxima', $2)`,
      [a, avisada],
    );
    expect((await listar()).map((l) => l.sessao_id)).toEqual([outra]);
  });

  it('notificação de outro tipo com a mesma referência não conta', async () => {
    const id = await sessao(a, pacienteA, ATE);
    await consultar(
      `insert into notificacao_enviada (usuario_id, tipo, ref) values ($1, 'cobranca_gerada', $2)`,
      [a, id],
    );
    expect((await listar()).map((l) => l.sessao_id)).toEqual([id]);
  });

  it('respeita o limite, pela ordem de início', async () => {
    const primeira = await sessao(a, pacienteA, DE);
    const segunda = await sessao(b, pacienteB, new Date(DE.getTime() + MIN));
    await sessao(a, pacienteA, ATE);
    expect((await listar(DE, ATE, 2)).map((l) => l.sessao_id)).toEqual([primeira, segunda]);
  });

  it('a sessão aparece uma vez mesmo com várias assinaturas do profissional', async () => {
    await sessao(a, pacienteA, ATE);
    expect(await listar()).toHaveLength(1);
  });

  it('recusa intervalo nulo ou invertido e limite fora de 1 a 1000', async () => {
    for (const [de, ate, limite] of [
      [null, ATE, 10],
      [DE, null, 10],
      [ATE, DE, 10],
      [DE, ATE, null],
      [DE, ATE, 0],
      [DE, ATE, 1001],
    ] as const)
      expect(await codigoDoErro(() => listar(de, ate, limite))).toBe(PARAMETRO_INVALIDO);
  });
});

describe('segurança da função (ISO-03, ADR-005)', () => {
  it('é SECURITY DEFINER do owner com search_path fixo; a app executa, evolucao_backup_ro não', async () => {
    expect(
      await consultar(
        `select pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer,
                exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                        where c like 'search_path=%') as search_path_fixo,
                has_function_privilege('evolucao_app', p.oid, 'EXECUTE') as app,
                has_function_privilege('evolucao_backup_ro', p.oid, 'EXECUTE') as evolucao_backup_ro
         from pg_proc p
         where p.oid = 'tarefas.listar_sessoes_para_aviso(timestamptz, timestamptz, integer)'::regprocedure`,
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

  it('fora da função, nem a app com a variável ligada nem o owner leem linha alheia', async () => {
    await sessao(a, pacienteA, ATE);
    const ver = () =>
      consultar(`select 1 from sessao_atendimento union all select 1 from push_subscription`);
    expect(
      await comoRole(banco.cliente, 'evolucao_app', async () => {
        await banco.cliente.query("select set_config('app.tarefa_push', 'on', true)");
        return ver();
      }),
    ).toEqual([]);
    expect(await comoRole(banco.cliente, 'evolucao_owner', ver)).toEqual([]);
  });
});
