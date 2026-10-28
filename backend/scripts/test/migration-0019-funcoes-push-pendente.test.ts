import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T145 / PUSH-03, PUSH-05, ISO-03 (ADR-005, ADR-010): migration 0019 cria
// tarefas.listar_pendencias_evolucao(dia, limite), com que o cron acha, entre todos os
// profissionais, quem tem sessões `realizada` no dia de Brasília pedido sem evolução, tem push
// ativo e ainda não recebeu o aviso 'evolucao_pendente' desse dia. Devolve só usuario_id e a
// quantidade (nada do paciente nem da evolução), até `limite` profissionais.
// SECURITY DEFINER do owner, search_path fixo; a app executa, evolucao_backup_ro e PUBLIC não; a leitura
// liberada ao owner vale só dentro da função.

const PARAMETRO_INVALIDO = '22023';
const DIA = '2026-11-10';
// 10/11/2026 em Brasília (UTC-3): de 03:00Z do dia 10 a 03:00Z do dia 11 (exclusivo).
const INICIO_DO_DIA = new Date('2026-11-10T03:00:00.000Z');
const FIM_DO_DIA = new Date('2026-11-11T03:00:00.000Z');
const AS_14H = new Date('2026-11-10T17:00:00.000Z');
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
  banco = await criarBancoMigrado('m0019');
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
  await banco.cliente.query('delete from evolucao');
  await banco.cliente.query('delete from sessao_atendimento');
});

async function sessao(
  usuario: string,
  paciente: string,
  inicio: Date,
  status = 'realizada',
): Promise<string> {
  const [linha] = await consultar<{ id: string }>(
    `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim, status)
     values ($1, $2, $3, $4, $5) returning id`,
    [usuario, paciente, inicio, new Date(inicio.getTime() + 50 * MIN), status],
  );
  return linha!.id;
}

async function evoluir(usuario: string, paciente: string, sessaoId: string) {
  await consultar(
    `insert into evolucao (usuario_id, paciente_id, sessao_id, texto) values ($1, $2, $3, 'Texto')`,
    [usuario, paciente, sessaoId],
  );
}

const listar = (dia: string | null = DIA, limite: number | null = 10) =>
  comoRole(banco.cliente, 'evolucao_app', () =>
    consultar<{ usuario_id: string; quantidade: number }>(
      'select * from tarefas.listar_pendencias_evolucao($1, $2)',
      [dia, limite],
    ),
  );

describe('listar_pendencias_evolucao (PUSH-03)', () => {
  it('devolve o profissional e a quantidade de sessões realizadas do dia sem evolução', async () => {
    await sessao(a, pacienteA, AS_14H);
    await sessao(a, pacienteA, new Date(AS_14H.getTime() + 60 * MIN));
    expect(await listar()).toEqual([{ usuario_id: a, quantidade: 2 }]);
  });

  it('sessão com evolução não conta; sem pendências, ninguém aparece', async () => {
    const feita = await sessao(a, pacienteA, AS_14H);
    await evoluir(a, pacienteA, feita);
    expect(await listar()).toEqual([]);
    await sessao(a, pacienteA, new Date(AS_14H.getTime() + 60 * MIN));
    expect(await listar()).toEqual([{ usuario_id: a, quantidade: 1 }]);
  });

  it('o dia é o de Brasília: 00:00 entra, 00:00 do dia seguinte não; 1 ms antes não', async () => {
    await sessao(a, pacienteA, INICIO_DO_DIA);
    await sessao(a, pacienteA, new Date(FIM_DO_DIA.getTime() - 1));
    await sessao(a, pacienteA, FIM_DO_DIA);
    await sessao(a, pacienteA, new Date(INICIO_DO_DIA.getTime() - 1));
    expect(await listar()).toEqual([{ usuario_id: a, quantidade: 2 }]);
  });

  it('só sessões realizadas contam', async () => {
    for (const status of ['agendada', 'faltou', 'cancelada', 'remarcada'])
      await sessao(a, pacienteA, AS_14H, status);
    expect(await listar()).toEqual([]);
  });

  it('só de quem tem push ativo', async () => {
    await sessao(semPush, pacienteSemPush, AS_14H);
    expect(await listar()).toEqual([]);
  });

  it('uma vez por dia: quem já recebeu o aviso do dia sai da lista; o de outro dia não conta', async () => {
    await sessao(a, pacienteA, AS_14H);
    await sessao(b, pacienteB, AS_14H);
    await consultar(
      `insert into notificacao_enviada (usuario_id, tipo, ref)
       values ($1, 'evolucao_pendente', $3), ($2, 'evolucao_pendente', '2026-11-09'),
              ($2, 'sessao_proxima', $3)`,
      [a, b, DIA],
    );
    expect(await listar()).toEqual([{ usuario_id: b, quantidade: 1 }]);
  });

  it('cada profissional conta só as próprias sessões e aparece uma vez', async () => {
    await sessao(a, pacienteA, AS_14H);
    await sessao(b, pacienteB, AS_14H);
    await sessao(b, pacienteB, AS_14H);
    const linhas = await listar();
    expect(linhas).toHaveLength(2);
    expect(linhas).toEqual(
      expect.arrayContaining([
        { usuario_id: a, quantidade: 1 },
        { usuario_id: b, quantidade: 2 },
      ]),
    );
  });

  it('respeita o limite de profissionais', async () => {
    await sessao(a, pacienteA, AS_14H);
    await sessao(b, pacienteB, AS_14H);
    expect(await listar(DIA, 1)).toHaveLength(1);
  });

  it('recusa dia nulo e limite fora de 1 a 1000', async () => {
    for (const [dia, limite] of [
      [null, 10],
      [DIA, null],
      [DIA, 0],
      [DIA, 1001],
    ] as const)
      expect(await codigoDoErro(() => listar(dia, limite))).toBe(PARAMETRO_INVALIDO);
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
         where p.oid = 'tarefas.listar_pendencias_evolucao(date, integer)'::regprocedure`,
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

  it('fora da função, nem a app com a variável ligada nem o owner leem evolução alheia', async () => {
    const id = await sessao(a, pacienteA, AS_14H);
    await evoluir(a, pacienteA, id);
    const ver = () => consultar(`select 1 from evolucao`);
    expect(
      await comoRole(banco.cliente, 'evolucao_app', async () => {
        await banco.cliente.query("select set_config('app.tarefa_push', 'on', true)");
        return ver();
      }),
    ).toEqual([]);
    expect(await comoRole(banco.cliente, 'evolucao_owner', ver)).toEqual([]);
  });
});
