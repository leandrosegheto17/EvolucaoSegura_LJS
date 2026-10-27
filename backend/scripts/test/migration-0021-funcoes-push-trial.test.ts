import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T178 / PUSH-04, PUSH-05, ISO-03 (ADR-005, ADR-010): migration 0021 cria
// tarefas.listar_trials_terminando(agora, limite), com que o cron acha, entre todos os
// profissionais, as assinaturas em trial que terminam em até 3 dias (periodo_fim em
// (agora, agora + 3 dias], a janela do domínio, emJanelaTrialTerminando), de quem tem push ativo e
// ainda sem o aviso 'trial_terminando' desse fim. A ref é o periodo_fim em ISO 8601 UTC com
// milissegundos (o Date.toISOString do domínio, chaveTrialTerminando). Devolve só usuario_id,
// periodo_fim e ref, até `limite`, do fim mais próximo ao mais distante.
// SECURITY DEFINER do owner, search_path fixo; a app executa, backup_ro e PUBLIC não; a leitura
// liberada ao owner vale só dentro da função.

const PARAMETRO_INVALIDO = '22023';
const AGORA = new Date('2026-11-10T17:00:00.000Z');
const DIA = 24 * 60 * 60_000;

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
  banco = await criarBancoMigrado('m0021');
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
  await banco.cliente.query('delete from assinatura');
});

async function assinatura(usuarioId: string, periodoFim: Date | string, status = 'trial') {
  await consultar(
    `insert into assinatura (usuario_id, plano, status, periodo_fim) values ($1, $2, $3, $4)`,
    [usuarioId, status === 'free' ? 'free' : 'pro', status, periodoFim],
  );
}

type Linha = { usuario_id: string; periodo_fim: Date; ref: string };

const listar = (agora: Date | null = AGORA, limite: number | null = 10) =>
  comoRole(banco.cliente, 'app', () =>
    consultar<Linha>('select * from tarefas.listar_trials_terminando($1, $2)', [agora, limite]),
  );

describe('listar_trials_terminando (PUSH-04)', () => {
  it('devolve o trial que termina em até 3 dias, com o fim e a ref no formato do domínio', async () => {
    const fim = new Date(AGORA.getTime() + 2 * DIA);
    await assinatura(a, fim);
    expect(await listar()).toEqual([{ usuario_id: a, periodo_fim: fim, ref: fim.toISOString() }]);
  });

  it('a ref trunca os microssegundos aos milissegundos, como o Date do JS', async () => {
    await assinatura(a, '2026-11-12T10:20:30.123987Z');
    expect((await listar()).map((l) => l.ref)).toEqual(['2026-11-12T10:20:30.123Z']);
  });

  it('a janela é (agora, agora + 3 dias]: o fim em 3 dias entra; 1 ms depois e o vencido não', async () => {
    await assinatura(a, new Date(AGORA.getTime() + 3 * DIA));
    await assinatura(b, new Date(AGORA.getTime() + 3 * DIA + 1));
    expect((await listar()).map((l) => l.usuario_id)).toEqual([a]);
    await banco.cliente.query('delete from assinatura');
    await assinatura(a, AGORA);
    await assinatura(b, new Date(AGORA.getTime() - 1));
    expect(await listar()).toEqual([]);
  });

  it('só assinatura em trial', async () => {
    await assinatura(a, new Date(AGORA.getTime() + DIA), 'ativa');
    await assinatura(b, new Date(AGORA.getTime() + DIA), 'cancelada');
    expect(await listar()).toEqual([]);
    await banco.cliente.query('delete from assinatura');
    await assinatura(a, new Date(AGORA.getTime() + DIA), 'atrasada');
    await assinatura(b, new Date(AGORA.getTime() + DIA), 'free');
    expect(await listar()).toEqual([]);
  });

  it('só de quem tem push ativo', async () => {
    await assinatura(semPush, new Date(AGORA.getTime() + DIA));
    expect(await listar()).toEqual([]);
  });

  it('uma vez por evento: o fim já avisado sai; aviso de outro fim não conta', async () => {
    const fim = new Date(AGORA.getTime() + DIA);
    await assinatura(a, fim);
    await assinatura(b, fim);
    await consultar(
      `insert into notificacao_enviada (usuario_id, tipo, ref)
       values ($1, 'trial_terminando', $3), ($2, 'trial_terminando', '2026-01-01T00:00:00.000Z'),
              ($2, 'cobranca_gerada', $3)`,
      [a, b, fim.toISOString()],
    );
    expect((await listar()).map((l) => l.usuario_id)).toEqual([b]);
  });

  it('respeita o limite, do fim mais próximo ao mais distante', async () => {
    await assinatura(a, new Date(AGORA.getTime() + 2 * DIA));
    await assinatura(b, new Date(AGORA.getTime() + DIA));
    expect((await listar(AGORA, 1)).map((l) => l.usuario_id)).toEqual([b]);
    expect((await listar()).map((l) => l.usuario_id)).toEqual([b, a]);
  });

  it('recusa agora nulo e limite fora de 1 a 1000', async () => {
    for (const [agora, limite] of [
      [null, 10],
      [AGORA, null],
      [AGORA, 0],
      [AGORA, 1001],
    ] as const)
      expect(await codigoDoErro(() => listar(agora, limite))).toBe(PARAMETRO_INVALIDO);
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
         where p.oid = 'tarefas.listar_trials_terminando(timestamptz, integer)'::regprocedure`,
      ),
    ).toEqual([
      { dono: 'owner', definer: true, search_path_fixo: true, app: true, backup_ro: false },
    ]);
  });

  it('fora da função, nem a app com a variável ligada nem o owner leem assinatura alheia', async () => {
    await assinatura(a, new Date(AGORA.getTime() + DIA));
    const ver = () => consultar(`select 1 from assinatura`);
    expect(
      await comoRole(banco.cliente, 'app', async () => {
        await banco.cliente.query("select set_config('app.tarefa_push', 'on', true)");
        return ver();
      }),
    ).toEqual([]);
    expect(await comoRole(banco.cliente, 'owner', ver)).toEqual([]);
  });
});
