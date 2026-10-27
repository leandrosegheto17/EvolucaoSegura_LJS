import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T170 / PLANO-04, PLANO-10, PLANO-11, ISO-03 (ADR-005): migration 0015 cria as funções tarefas.*
// com que o cron (T137) leva a free, entre todos os profissionais, as assinaturas cujo tempo
// acabou (regras da T125, estadoPorTempo):
// - trial e cancelada com periodo_fim <= agora (periodo_fim igual a agora já não está no futuro);
// - atrasada com 7 dias completos (exatamente 7 dias conta) desde vencimento_atraso ou, sem ele,
//   desde periodo_fim;
// - ativa e free nunca.
// tarefas.listar_assinaturas_vencidas(agora, limite) devolve só usuario_id, status e
// asaas_subscription_id, com o tempo por parâmetro, até `limite` linhas, as mais antigas primeiro.
// tarefas.desvincular_assinatura_asaas(usuario) limpa o asaas_subscription_id da assinatura já em
// free (decisão do usuário, 2026-10-27: depois de cancelar no Asaas por atraso, o GET /api/plano
// não consulta mais o Asaas); nos demais estados não muda nada.
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados; app executa, backup_ro e
// PUBLIC não.

const PARAMETRO_INVALIDO = '22023';
const AGORA = new Date('2026-11-10T12:00:00.000Z');
const MS = 1;
const DIA = 24 * 60 * 60 * 1000;
const antes = (ms: number) => new Date(AGORA.getTime() - ms);
const depois = (ms: number) => new Date(AGORA.getTime() + ms);

let banco: BancoDeTeste;
let sequencia = 0;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0015');
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

beforeEach(async () => {
  await banco.cliente.query('delete from assinatura');
});

type Estado = 'trial' | 'ativa' | 'atrasada' | 'cancelada' | 'free';

// Profissional novo com assinatura semeada como superusuário (a RLS não vale para ele).
async function semear(
  status: Estado,
  periodoFim: Date,
  opcoes: { vencimentoAtraso?: Date | null; assinatura?: string | null } = {},
): Promise<string> {
  sequencia += 1;
  const {
    rows: [u],
  } = await banco.cliente.query<{ id: string }>(
    `insert into usuario (email, nome) values ($1, 'Pessoa') returning id`,
    [`p${sequencia}@exemplo.com`],
  );
  await banco.cliente.query(
    `insert into assinatura (usuario_id, plano, status, asaas_customer_id, asaas_subscription_id,
                             periodo_fim, vencimento_atraso)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      u!.id,
      status === 'free' ? 'free' : 'pro',
      status,
      `cus_${sequencia}`,
      opcoes.assinatura === undefined ? `sub_${sequencia}` : opcoes.assinatura,
      periodoFim,
      opcoes.vencimentoAtraso ?? null,
    ],
  );
  return u!.id;
}

interface Vencida {
  usuario_id: string;
  status: string;
  asaas_subscription_id: string | null;
}

// Chamada como app, sem usuário na transação (o cron não tem sessão).
const listar = (agora: Date | null = AGORA, limite: number | null = 100) =>
  comoRole(banco.cliente, 'app', async () => {
    const { rows } = await banco.cliente.query<Vencida>(
      'select * from tarefas.listar_assinaturas_vencidas($1, $2)',
      [agora, limite],
    );
    return rows;
  });

const desvincular = (usuario: string | null) =>
  comoRole(banco.cliente, 'app', async () => {
    const { rows } = await banco.cliente.query<{ r: string }>(
      'select tarefas.desvincular_assinatura_asaas($1) as r',
      [usuario],
    );
    const linha = usuario
      ? (
          await banco.cliente.query('reset role').then(() =>
            banco.cliente.query(
              `select plano, status, asaas_customer_id, asaas_subscription_id, periodo_fim,
                      vencimento_atraso, atualizado_em = now() as atualizada_agora
               from assinatura where usuario_id = $1`,
              [usuario],
            ),
          )
        ).rows[0]
      : undefined;
    return { resultado: rows[0]!.r, linha };
  });

const ids = (linhas: Vencida[]) => linhas.map((l) => l.usuario_id).sort();

describe('catálogo: SECURITY DEFINER, search_path fixo, tipos e grants (ISO-03)', () => {
  const FUNCOES = {
    'tarefas.listar_assinaturas_vencidas(timestamptz, integer)':
      'p_agora timestamp with time zone, p_limite integer',
    'tarefas.desvincular_assinatura_asaas(uuid)': 'p_usuario_id uuid',
  };

  it.each(Object.entries(FUNCOES))(
    '%s é do owner, definer, com search_path fixo e parâmetros tipados',
    async (assinatura, argumentos) => {
      const { rows } = await banco.cliente.query(
        `select pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer,
                exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                        where c = 'search_path=pg_catalog, pg_temp') as search_path_fixo,
                pg_get_function_identity_arguments(p.oid) as argumentos,
                p.prosrc ~* '\\mexecute\\M' as sql_dinamico
         from pg_proc p where p.oid = $1::regprocedure`,
        [assinatura],
      );
      expect(rows).toEqual([
        { dono: 'owner', definer: true, search_path_fixo: true, argumentos, sql_dinamico: false },
      ]);
    },
  );

  it.each(Object.keys(FUNCOES))('%s: app executa; backup_ro e PUBLIC não', async (assinatura) => {
    const { rows } = await banco.cliente.query(
      `select has_function_privilege('app', $1::regprocedure, 'EXECUTE') as app,
              has_function_privilege('backup_ro', $1::regprocedure, 'EXECUTE') as backup_ro,
              exists (select 1 from aclexplode((select proacl from pg_proc
                                                where oid = $1::regprocedure)) a
                      where a.grantee = 0) as public`,
      [assinatura],
    );
    expect(rows).toEqual([{ app: true, backup_ro: false, public: false }]);
  });

  it('listar devolve só usuario_id, status e asaas_subscription_id', async () => {
    const { rows } = await banco.cliente.query(
      `select pg_get_function_result('tarefas.listar_assinaturas_vencidas(timestamptz, integer)'::regprocedure) as r`,
    );
    expect(rows[0]!.r).toBe('TABLE(usuario_id uuid, status text, asaas_subscription_id text)');
  });

  it('a app continua sem UPDATE direto na assinatura', async () => {
    const { rows } = await banco.cliente.query(
      `select has_any_column_privilege('app', 'assinatura', 'UPDATE') as update`,
    );
    expect(rows).toEqual([{ update: false }]);
  });
});

describe('listar_assinaturas_vencidas: trial e cancelada (PLANO-04, PLANO-11)', () => {
  it.each(['trial', 'cancelada'] as const)(
    '%s: periodo_fim antes ou igual a agora entra; depois de agora, não',
    async (status) => {
      const vencida = await semear(status, antes(MS));
      const noLimite = await semear(status, AGORA);
      await semear(status, depois(MS));

      const linhas = await listar();

      expect(ids(linhas)).toEqual([vencida, noLimite].sort());
      expect(linhas.every((l) => l.status === status)).toBe(true);
    },
  );

  it('devolve o asaas_subscription_id (nulo no trial sem Asaas)', async () => {
    const semAsaas = await semear('trial', antes(DIA), { assinatura: null });
    const cancelada = await semear('cancelada', antes(DIA), { assinatura: 'sub_cancelada' });

    const linhas = await listar();

    expect(linhas.sort((a, b) => a.usuario_id.localeCompare(b.usuario_id))).toEqual(
      [
        { usuario_id: semAsaas, status: 'trial', asaas_subscription_id: null },
        { usuario_id: cancelada, status: 'cancelada', asaas_subscription_id: 'sub_cancelada' },
      ].sort((a, b) => a.usuario_id.localeCompare(b.usuario_id)),
    );
  });
});

describe('listar_assinaturas_vencidas: atrasada com 7 dias de tolerância (PLANO-10, D-21)', () => {
  it('exatamente 7 dias desde vencimento_atraso entra; 1 ms antes, não', async () => {
    const esgotada = await semear('atrasada', antes(30 * DIA), {
      vencimentoAtraso: antes(7 * DIA),
    });
    const passou = await semear('atrasada', antes(30 * DIA), {
      vencimentoAtraso: antes(8 * DIA),
    });
    await semear('atrasada', antes(30 * DIA), { vencimentoAtraso: antes(7 * DIA - MS) });

    expect(ids(await listar())).toEqual([esgotada, passou].sort());
  });

  it('sem vencimento_atraso, conta a tolerância desde periodo_fim', async () => {
    const esgotada = await semear('atrasada', antes(7 * DIA), { vencimentoAtraso: null });
    await semear('atrasada', antes(7 * DIA - MS), { vencimentoAtraso: null });

    expect(ids(await listar())).toEqual([esgotada]);
  });

  it('vencimento_atraso tem precedência sobre periodo_fim', async () => {
    // periodo_fim antigo, mas a tolerância começou há 1 dia: ainda não esgotou.
    await semear('atrasada', antes(60 * DIA), { vencimentoAtraso: antes(DIA) });

    expect(await listar()).toEqual([]);
  });
});

describe('listar_assinaturas_vencidas: o que nunca entra e os parâmetros', () => {
  it('ativa e free nunca entram, mesmo com datas no passado', async () => {
    await semear('ativa', antes(60 * DIA));
    await semear('free', antes(60 * DIA), { assinatura: null });

    expect(await listar()).toEqual([]);
  });

  it('o tempo vem do parâmetro, não do relógio do banco', async () => {
    const id = await semear('trial', new Date('2030-01-01T00:00:00.000Z'));

    expect(await listar(new Date('2029-12-31T23:59:59.999Z'))).toEqual([]);
    expect(ids(await listar(new Date('2030-01-01T00:00:00.000Z')))).toEqual([id]);
  });

  it('enxerga assinaturas de todos os profissionais, sem usuário na transação', async () => {
    const a = await semear('trial', antes(DIA));
    const b = await semear('cancelada', antes(DIA));
    const c = await semear('atrasada', antes(DIA), { vencimentoAtraso: antes(10 * DIA) });

    expect(ids(await listar())).toEqual([a, b, c].sort());
  });

  it('respeita o limite, das que venceram há mais tempo para as mais recentes', async () => {
    const recente = await semear('trial', antes(DIA));
    const antiga = await semear('cancelada', antes(5 * DIA));
    // Tolerância esgotada há 3 dias (venceu há 10, 7 de tolerância).
    const meio = await semear('atrasada', antes(20 * DIA), { vencimentoAtraso: antes(10 * DIA) });

    expect((await listar(AGORA, 2)).map((l) => l.usuario_id)).toEqual([antiga, meio]);
    expect((await listar(AGORA, 3)).map((l) => l.usuario_id)).toEqual([antiga, meio, recente]);
  });

  it.each([
    ['agora nulo', null, 10],
    ['limite nulo', AGORA, null],
    ['limite zero', AGORA, 0],
    ['limite negativo', AGORA, -1],
    ['limite acima de 1000', AGORA, 1001],
  ])('%s: erro 22023', async (_caso, agora, limite) => {
    expect(await codigoDoErro(() => listar(agora as Date | null, limite as number | null))).toBe(
      PARAMETRO_INVALIDO,
    );
  });
});

describe('desvincular_assinatura_asaas', () => {
  it('em free, limpa só o asaas_subscription_id e devolve "desvinculada"', async () => {
    const id = await semear('free', antes(DIA), { assinatura: 'sub_x' });

    const { resultado, linha } = await desvincular(id);

    expect(resultado).toBe('desvinculada');
    expect(linha).toMatchObject({
      plano: 'free',
      status: 'free',
      asaas_customer_id: expect.stringMatching(/^cus_/),
      asaas_subscription_id: null,
      periodo_fim: antes(DIA),
      vencimento_atraso: null,
      atualizada_agora: true,
    });
  });

  it('reexecução não muda nada e devolve "sem_vinculo"', async () => {
    const id = await semear('free', antes(DIA), { assinatura: null });

    const { resultado, linha } = await desvincular(id);

    expect(resultado).toBe('sem_vinculo');
    expect(linha).toMatchObject({ asaas_subscription_id: null, atualizada_agora: false });
  });

  it.each(['trial', 'ativa', 'atrasada', 'cancelada'] as const)(
    'em %s não muda nada e devolve "nao_free"',
    async (status) => {
      const id = await semear(status, antes(DIA), {
        assinatura: `sub_${status}`,
        vencimentoAtraso: status === 'atrasada' ? antes(10 * DIA) : null,
      });

      const { resultado, linha } = await desvincular(id);

      expect(resultado).toBe('nao_free');
      expect(linha).toMatchObject({
        status,
        asaas_subscription_id: `sub_${status}`,
        atualizada_agora: false,
      });
    },
  );

  it('usuário sem assinatura devolve "inexistente"', async () => {
    expect((await desvincular('99999999-9999-4999-8999-999999999999')).resultado).toBe(
      'inexistente',
    );
  });

  it('usuário nulo: erro 22023', async () => {
    expect(await codigoDoErro(() => desvincular(null))).toBe(PARAMETRO_INVALIDO);
  });
});
