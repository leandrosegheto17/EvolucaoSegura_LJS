import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T128 / PLANO-05, ISO-01, ISO-03: migration 0013 cria public.gravar_ids_asaas, com que a rota de
// assinar grava os ids do cliente e da assinatura do Asaas só na assinatura do profissional da
// transação, sem dar UPDATE direto à app (decisão do usuário, 2026-10-27).
// - Grava os dois ids e atualizado_em; não toca em plano, status, periodo_fim nem
//   vencimento_atraso; devolve true, ou false quando o profissional não tem assinatura.
// - Nunca toca a assinatura de outro; sem usuário na transação, 42501; id ausente, 22023.
// - SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico; app
//   executa, evolucao_backup_ro e PUBLIC não.

const SEM_PERMISSAO_OU_RLS = '42501';
const PARAMETRO_INVALIDO = '22023';
const DUPLICADO = '23505';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SEM_ASSINATURA = '33333333-3333-4333-8333-333333333333';
const PERIODO = new Date('2026-11-10T03:00:00.000Z');
const ASSINATURA = 'public.gravar_ids_asaas(text, text)';

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0013');
  await banco.cliente.query(
    `insert into usuario (id, email, nome)
     values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B'), ($3, 'c@exemplo.com', 'C')`,
    [A, B, SEM_ASSINATURA],
  );
  await banco.cliente.query(
    `insert into assinatura (usuario_id, plano, status, asaas_customer_id, asaas_subscription_id,
                             periodo_fim, atualizado_em)
     values ($1, 'pro', 'trial', null, null, $3, '2026-01-01T00:00:00Z'),
            ($2, 'free', 'free', 'cus_b', 'sub_b', $3, '2026-01-01T00:00:00Z')`,
    [A, B, PERIODO],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

const gravar = async (cliente: string | null, assinatura: string | null) =>
  (
    await consultar<{ gravou: boolean }>('select public.gravar_ids_asaas($1, $2) as gravou', [
      cliente,
      assinatura,
    ])
  )[0]!.gravou;

// Linha lida como superusuário, na transação corrente.
const linha = async (usuario: string) =>
  (
    await consultar<Record<string, unknown>>(
      `select plano, status, asaas_customer_id, asaas_subscription_id, periodo_fim,
              vencimento_atraso, atualizado_em = now() as atualizado_agora
       from assinatura where usuario_id = $1`,
      [usuario],
    )
  )[0];

// Chama como app com `usuario` na transação e devolve o resultado e as linhas de A e B depois.
const comoApp = (usuario: string, fn: () => Promise<unknown>) =>
  comoRole(
    banco.cliente,
    'evolucao_app',
    async () => {
      const resultado = await fn();
      await banco.cliente.query('reset role');
      return { resultado, a: await linha(A), b: await linha(B) };
    },
    usuario,
  );

describe('catálogo (ISO-03)', () => {
  it('é do owner, definer, com search_path fixo, parâmetros tipados e sem SQL dinâmico', async () => {
    expect(
      await consultar(
        `select pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer,
                exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                        where c = 'search_path=pg_catalog, pg_temp') as search_path_fixo,
                not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'app.%') as sem_app_na_configuracao,
                p.prosrc ~ 'set_config\\(''app\\.tarefa_assinatura'', ''off'', true\\)'
                  as contexto_tarefas_desligado,
                pg_get_function_identity_arguments(p.oid) as argumentos,
                p.prosrc ~* '\\mexecute\\M' as sql_dinamico
         from pg_proc p where p.oid = $1::regprocedure`,
        [ASSINATURA],
      ),
    ).toEqual([
      {
        dono: 'evolucao_owner',
        definer: true,
        search_path_fixo: true,
        sem_app_na_configuracao: true,
        contexto_tarefas_desligado: true,
        argumentos: 'p_asaas_customer_id text, p_asaas_subscription_id text',
        sql_dinamico: false,
      },
    ]);
  });

  it('app executa; evolucao_backup_ro e PUBLIC não', async () => {
    expect(
      await consultar(
        `select has_function_privilege('evolucao_app', $1::regprocedure, 'EXECUTE') as app,
                has_function_privilege('evolucao_backup_ro', $1::regprocedure, 'EXECUTE') as evolucao_backup_ro,
                exists (select 1 from aclexplode((select proacl from pg_proc
                                                  where oid = $1::regprocedure)) a
                        where a.grantee = 0) as public`,
        [ASSINATURA],
      ),
    ).toEqual([{ app: true, evolucao_backup_ro: false, public: false }]);
  });
});

describe('gravar_ids_asaas (PLANO-05)', () => {
  it('grava os dois ids só na assinatura do profissional da transação, sem mudar o estado', async () => {
    const { resultado, a, b } = await comoApp(A, () => gravar('cus_a', 'sub_a'));
    expect(resultado).toBe(true);
    expect(a).toEqual({
      plano: 'pro',
      status: 'trial',
      asaas_customer_id: 'cus_a',
      asaas_subscription_id: 'sub_a',
      periodo_fim: PERIODO,
      vencimento_atraso: null,
      atualizado_agora: true,
    });
    expect(b).toMatchObject({ asaas_customer_id: 'cus_b', asaas_subscription_id: 'sub_b' });
  });

  it('troca os ids já gravados (nova assinatura depois de cair para free)', async () => {
    const { resultado, b } = await comoApp(B, () => gravar('cus_b', 'sub_b2'));
    expect(resultado).toBe(true);
    expect(b).toMatchObject({
      plano: 'free',
      status: 'free',
      asaas_customer_id: 'cus_b',
      asaas_subscription_id: 'sub_b2',
    });
  });

  it('profissional sem assinatura devolve false e não cria nada', async () => {
    const { resultado, a, b } = await comoApp(SEM_ASSINATURA, () => gravar('cus_c', 'sub_c'));
    expect(resultado).toBe(false);
    expect(a).toMatchObject({ asaas_customer_id: null, asaas_subscription_id: null });
    expect(b).toMatchObject({ asaas_subscription_id: 'sub_b' });
  });

  it('com o contexto das tarefas ligado pela app, grava só a própria e o valor volta ao fim', async () => {
    const { resultado, b } = await comoApp(A, async () => {
      await banco.cliente.query("select set_config('app.tarefa_assinatura', 'on', true)");
      const gravou = await gravar('cus_a2', 'sub_a2');
      const [linha] = await consultar<{ c: string }>(
        "select current_setting('app.tarefa_assinatura', true) as c",
      );
      return { gravou, contexto: linha!.c };
    });
    expect(resultado).toEqual({ gravou: true, contexto: 'on' });
    expect(b).toMatchObject({ asaas_customer_id: 'cus_b', asaas_subscription_id: 'sub_b' });
  });

  it('id já usado por outra assinatura é recusado', async () => {
    const codigo = await comoRole(
      banco.cliente,
      'evolucao_app',
      () => codigoDoErro(() => gravar('cus_b', 'sub_novo')),
      A,
    );
    expect(codigo).toBe(DUPLICADO);
  });

  it('sem usuário na transação recusa com 42501', async () => {
    const codigo = await comoRole(banco.cliente, 'evolucao_app', () =>
      codigoDoErro(() => gravar('cus_a', 'sub_a')),
    );
    expect(codigo).toBe(SEM_PERMISSAO_OU_RLS);
  });

  it('id nulo ou vazio recusa com 22023', async () => {
    const casos: [string | null, string | null][] = [
      [null, 'sub_a'],
      ['cus_a', null],
      ['', 'sub_a'],
      ['cus_a', ''],
    ];
    for (const [cliente, assinatura] of casos)
      expect(
        await comoRole(
          banco.cliente,
          'evolucao_app',
          () => codigoDoErro(() => gravar(cliente, assinatura)),
          A,
        ),
        JSON.stringify([cliente, assinatura]),
      ).toBe(PARAMETRO_INVALIDO);
  });
});
