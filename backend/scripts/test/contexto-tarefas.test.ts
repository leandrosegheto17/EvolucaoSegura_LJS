import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T197 e T198 / OPS-03 (ISO-03, ADR-005): as funções SECURITY DEFINER do owner que ligam (ou desligam) um
// contexto app.tarefa_* não declaram mais `SET app.* = ...` na definição, que no Neon (PG 18,
// neondb_owner sem superusuário) falha com "permission denied to set parameter". O contexto é
// ligado no corpo com set_config(..., true) e o valor que a transação tinha volta antes de cada
// RETURN, o mesmo efeito do SET na definição:
// - a configuração da função tem só o search_path fixo;
// - depois de qualquer caminho de saída, o contexto volta ao valor de antes da chamada (o que a
//   app tinha ligado, ou nada);
// - erro dentro da função desfaz a mudança junto com a transação (ou o savepoint).
// O efeito das policies em cada caminho é coberto nos testes de cada migration (0012 a 0015 na
// T197; 0018 a 0021, as de push, na T198).

const PARAMETRO_INVALIDO = '22023';
const ATIVA = '11111111-1111-4111-8111-111111111111';
const FREE_COM_ID = '22222222-2222-4222-8222-222222222222';
const FREE_SEM_ID = '33333333-3333-4333-8333-333333333333';
const TRIAL_VENCIDO = '44444444-4444-4444-8444-444444444444';
const SEM_ASSINATURA = '55555555-5555-4555-8555-555555555555';
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';
const FUTURO = '2099-01-01T00:00:00Z';
const PASSADO = '2026-01-01T00:00:00Z';
const AGORA = '2026-10-28T00:00:00Z';
// Três dias antes de PASSADO: o trial de TRIAL_VENCIDO está terminando.
const ANTES_DO_FIM_DO_TRIAL = '2025-12-30T00:00:00Z';
const ANTERIOR = 'valor-da-transacao';

interface Caso {
  // Caminho de saída da função coberto pelo caso.
  caminho: string;
  sql: string;
  parametros?: unknown[];
  usuario?: string;
  esperado: unknown;
}

interface Funcao {
  assinatura: string;
  variavel: string;
  casos: Caso[];
  // Chamada que a função recusa com 22023 (caminho de erro); localizar não tem.
  invalida?: { sql: string; parametros?: unknown[]; usuario?: string };
}

const FUNCOES: Funcao[] = [
  {
    assinatura: 'tarefas.localizar_assinatura_asaas(text, text)',
    variavel: 'app.tarefa_assinatura',
    casos: [
      {
        caminho: 'achada pela assinatura',
        sql: 'select usuario_id from tarefas.localizar_assinatura_asaas($1, $2)',
        parametros: ['sub_ativa', null],
        esperado: [{ usuario_id: ATIVA }],
      },
      {
        caminho: 'achada pelo cliente',
        sql: 'select usuario_id from tarefas.localizar_assinatura_asaas($1, $2)',
        parametros: ['sub_inexistente', 'cus_free_sem_id'],
        esperado: [{ usuario_id: FREE_SEM_ID }],
      },
      {
        caminho: 'não achada',
        sql: 'select usuario_id from tarefas.localizar_assinatura_asaas($1, $2)',
        parametros: ['sub_inexistente', 'cus_inexistente'],
        esperado: [],
      },
    ],
  },
  {
    assinatura: 'tarefas.mudar_estado_assinatura(uuid, text, timestamptz, timestamptz)',
    variavel: 'app.tarefa_assinatura',
    casos: [
      {
        caminho: 'inexistente',
        sql: "select resultado from tarefas.mudar_estado_assinatura($1, 'free', null, null)",
        parametros: [INEXISTENTE],
        esperado: [{ resultado: 'inexistente' }],
      },
      {
        caminho: 'mesmo_estado',
        sql: "select resultado from tarefas.mudar_estado_assinatura($1, 'ativa', $2, null)",
        parametros: [ATIVA, FUTURO],
        esperado: [{ resultado: 'mesmo_estado' }],
      },
      {
        caminho: 'transicao_invalida',
        sql: "select resultado from tarefas.mudar_estado_assinatura($1, 'trial', null, null)",
        parametros: [ATIVA],
        esperado: [{ resultado: 'transicao_invalida' }],
      },
      {
        caminho: 'permitida',
        sql: "select resultado from tarefas.mudar_estado_assinatura($1, 'cancelada', null, null)",
        parametros: [ATIVA],
        esperado: [{ resultado: 'permitida' }],
      },
    ],
    invalida: {
      sql: "select * from tarefas.mudar_estado_assinatura($1, 'invalido', null, null)",
      parametros: [ATIVA],
    },
  },
  {
    assinatura: 'public.gravar_ids_asaas(text, text)',
    variavel: 'app.tarefa_assinatura',
    casos: [
      {
        caminho: 'gravou',
        sql: "select public.gravar_ids_asaas('cus_novo', 'sub_novo') as r",
        usuario: ATIVA,
        esperado: [{ r: true }],
      },
      {
        caminho: 'sem assinatura',
        sql: "select public.gravar_ids_asaas('cus_novo', 'sub_novo') as r",
        usuario: SEM_ASSINATURA,
        esperado: [{ r: false }],
      },
    ],
    invalida: { sql: "select public.gravar_ids_asaas('', 'sub_novo')", usuario: ATIVA },
  },
  {
    assinatura: 'tarefas.gravar_webhook_evento(text, text, jsonb)',
    variavel: 'app.tarefa_webhook',
    casos: [
      {
        caminho: 'novo',
        sql: "select tarefas.gravar_webhook_evento('evt_novo', 'X', '{}') as r",
        esperado: [{ r: 'novo' }],
      },
      {
        caminho: 'repetido',
        sql: "select tarefas.gravar_webhook_evento('evt_pendente', 'X', '{}') as r",
        esperado: [{ r: 'repetido' }],
      },
    ],
    invalida: { sql: "select tarefas.gravar_webhook_evento('', 'X', '{}')" },
  },
  {
    assinatura: 'tarefas.marcar_webhook_processado(text, uuid)',
    variavel: 'app.tarefa_webhook',
    casos: [
      {
        caminho: 'inexistente',
        sql: "select tarefas.marcar_webhook_processado('evt_inexistente', null) as r",
        esperado: [{ r: 'inexistente' }],
      },
      {
        caminho: 'ja_processado',
        sql: "select tarefas.marcar_webhook_processado('evt_processado', null) as r",
        esperado: [{ r: 'ja_processado' }],
      },
      {
        caminho: 'marcado',
        sql: "select tarefas.marcar_webhook_processado('evt_pendente', null) as r",
        esperado: [{ r: 'marcado' }],
      },
    ],
    invalida: { sql: "select tarefas.marcar_webhook_processado('', null)" },
  },
  {
    assinatura: 'tarefas.listar_assinaturas_vencidas(timestamptz, integer)',
    variavel: 'app.tarefa_assinatura',
    casos: [
      {
        caminho: 'lista',
        sql: 'select usuario_id from tarefas.listar_assinaturas_vencidas($1, 10)',
        parametros: [AGORA],
        esperado: [{ usuario_id: TRIAL_VENCIDO }],
      },
    ],
    invalida: {
      sql: 'select * from tarefas.listar_assinaturas_vencidas($1, 0)',
      parametros: [AGORA],
    },
  },
  {
    assinatura: 'tarefas.desvincular_assinatura_asaas(uuid)',
    variavel: 'app.tarefa_assinatura',
    casos: [
      {
        caminho: 'inexistente',
        sql: 'select tarefas.desvincular_assinatura_asaas($1) as r',
        parametros: [INEXISTENTE],
        esperado: [{ r: 'inexistente' }],
      },
      {
        caminho: 'nao_free',
        sql: 'select tarefas.desvincular_assinatura_asaas($1) as r',
        parametros: [ATIVA],
        esperado: [{ r: 'nao_free' }],
      },
      {
        caminho: 'sem_vinculo',
        sql: 'select tarefas.desvincular_assinatura_asaas($1) as r',
        parametros: [FREE_SEM_ID],
        esperado: [{ r: 'sem_vinculo' }],
      },
      {
        caminho: 'desvinculada',
        sql: 'select tarefas.desvincular_assinatura_asaas($1) as r',
        parametros: [FREE_COM_ID],
        esperado: [{ r: 'desvinculada' }],
      },
    ],
    invalida: { sql: 'select tarefas.desvincular_assinatura_asaas(null)' },
  },
  {
    assinatura: 'tarefas.listar_sessoes_para_aviso(timestamptz, timestamptz, integer)',
    variavel: 'app.tarefa_push',
    casos: [
      {
        caminho: 'lista',
        sql: 'select usuario_id from tarefas.listar_sessoes_para_aviso($1, $2, 10)',
        parametros: [PASSADO, FUTURO],
        esperado: [],
      },
    ],
    invalida: {
      sql: 'select * from tarefas.listar_sessoes_para_aviso($1, $2, 10)',
      parametros: [FUTURO, PASSADO],
    },
  },
  {
    assinatura: 'tarefas.listar_pendencias_evolucao(date, integer)',
    variavel: 'app.tarefa_push',
    casos: [
      {
        caminho: 'lista',
        sql: "select usuario_id from tarefas.listar_pendencias_evolucao('2026-10-28', 10)",
        esperado: [],
      },
    ],
    invalida: { sql: 'select * from tarefas.listar_pendencias_evolucao(null, 10)' },
  },
  {
    assinatura: 'tarefas.listar_eventos_cobranca_para_aviso(timestamptz, timestamptz, integer)',
    variavel: 'app.tarefa_push',
    casos: [
      {
        caminho: 'lista',
        sql: 'select usuario_id from tarefas.listar_eventos_cobranca_para_aviso($1, $2, 10)',
        parametros: [PASSADO, FUTURO],
        esperado: [],
      },
    ],
    invalida: {
      sql: 'select * from tarefas.listar_eventos_cobranca_para_aviso($1, $2, 10)',
      parametros: [FUTURO, PASSADO],
    },
  },
  {
    assinatura: 'tarefas.listar_trials_terminando(timestamptz, integer)',
    variavel: 'app.tarefa_push',
    casos: [
      {
        caminho: 'lista',
        sql: 'select usuario_id from tarefas.listar_trials_terminando($1, 10)',
        parametros: [ANTES_DO_FIM_DO_TRIAL],
        esperado: [{ usuario_id: TRIAL_VENCIDO }],
      },
    ],
    invalida: {
      sql: 'select * from tarefas.listar_trials_terminando($1, 0)',
      parametros: [ANTES_DO_FIM_DO_TRIAL],
    },
  },
];

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('contexto');
  await banco.cliente.query(
    `insert into usuario (id, email, nome)
     values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B'), ($3, 'c@exemplo.com', 'C'),
            ($4, 'd@exemplo.com', 'D'), ($5, 'e@exemplo.com', 'E')`,
    [ATIVA, FREE_COM_ID, FREE_SEM_ID, TRIAL_VENCIDO, SEM_ASSINATURA],
  );
  await banco.cliente.query(
    `insert into assinatura
       (usuario_id, plano, status, asaas_customer_id, asaas_subscription_id, periodo_fim)
     values ($1, 'pro', 'ativa', 'cus_ativa', 'sub_ativa', $5),
            ($2, 'free', 'free', 'cus_free_com_id', 'sub_free_com_id', $6),
            ($3, 'free', 'free', 'cus_free_sem_id', null, $6),
            ($4, 'pro', 'trial', null, null, $6)`,
    [ATIVA, FREE_COM_ID, FREE_SEM_ID, TRIAL_VENCIDO, FUTURO, PASSADO],
  );
  await banco.cliente.query(
    `insert into webhook_evento (event_id, tipo, payload, processado_em)
     values ('evt_pendente', 'X', '{}', null), ('evt_processado', 'X', '{}', now())`,
  );
  await banco.cliente.query(
    `insert into push_subscription (usuario_id, endpoint, p256dh, auth)
     values ($1, 'https://push.exemplo.com/1', 'chave', 'segredo')`,
    [TRIAL_VENCIDO],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async (sql: string, parametros: unknown[] = []): Promise<unknown[]> =>
  (await banco.cliente.query(sql, parametros)).rows;

const contexto = async (variavel: string): Promise<string | null> =>
  (
    (await consultar(`select nullif(current_setting($1, true), '') as v`, [variavel]))[0] as {
      v: string | null;
    }
  ).v;

describe('configuração das funções sem SET app.* (OPS-03)', () => {
  it.each(FUNCOES.map((f) => f.assinatura))(
    '%s tem só o search_path fixo na configuração',
    async (assinatura) => {
      expect(
        await consultar('select proconfig from pg_proc where oid = $1::regprocedure', [assinatura]),
      ).toEqual([{ proconfig: ['search_path=pg_catalog, pg_temp'] }]);
    },
  );
});

const CASOS = FUNCOES.flatMap((f) =>
  f.casos.map((c) => ({ ...c, assinatura: f.assinatura, variavel: f.variavel })),
);

describe('contexto devolvido ao fim da chamada, em todo caminho de saída', () => {
  it.each(CASOS)(
    '$assinatura ($caminho): volta o valor que a transação tinha',
    async ({ sql, parametros, usuario, esperado, variavel }) => {
      const r = await comoRole(
        banco.cliente,
        'evolucao_app',
        async () => {
          await consultar('select set_config($1, $2, true)', [variavel, ANTERIOR]);
          const linhas = await consultar(sql, parametros);
          return { linhas, depois: await contexto(variavel) };
        },
        usuario,
      );
      expect(r).toEqual({ linhas: esperado, depois: ANTERIOR });
    },
  );

  it.each(CASOS)(
    '$assinatura ($caminho): sem contexto antes, fica sem contexto depois',
    async ({ sql, parametros, usuario, esperado, variavel }) => {
      const r = await comoRole(
        banco.cliente,
        'evolucao_app',
        async () => {
          const linhas = await consultar(sql, parametros);
          return { linhas, depois: await contexto(variavel) };
        },
        usuario,
      );
      expect(r).toEqual({ linhas: esperado, depois: null });
    },
  );

  it.each(FUNCOES.filter((f) => f.invalida))(
    '$assinatura: erro dentro da função (22023) não deixa o contexto mudado',
    async ({ invalida, variavel }) => {
      const r = await comoRole(
        banco.cliente,
        'evolucao_app',
        async () => {
          await consultar('select set_config($1, $2, true)', [variavel, ANTERIOR]);
          await consultar('savepoint antes_do_erro');
          const codigo = await codigoDoErro(() => consultar(invalida!.sql, invalida!.parametros));
          await consultar('rollback to savepoint antes_do_erro');
          return { codigo, depois: await contexto(variavel) };
        },
        invalida!.usuario,
      );
      expect(r).toEqual({ codigo: PARAMETRO_INVALIDO, depois: ANTERIOR });
    },
  );
});
