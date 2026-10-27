import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T139 / CAD-03, AUTH-09, ISO-03 (ADR-005): migration 0016 cria tarefas.vencer_tokens_e_sessoes,
// com que o cron marca como vencidos, sem apagar (a app não tem DELETE), entre todos os usuários:
// - token_email aberto (não usado nem invalidado) com expira_em <= agora: invalidado_em = agora
//   (CAD-03: no instante exato de expira_em o token já não vale);
// - sessao aberta 15 minutos depois do último uso ou 12 horas depois do login, o que vier
//   primeiro (AUTH-09; no instante exato do limite já está encerrada): encerrada_em = agora.
// Registros válidos, usados, já invalidados ou já encerrados ficam intactos; reexecução não muda
// nada. Devolve quantos tokens e sessões marcou. Tempo por parâmetro.
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados; app executa, backup_ro e
// PUBLIC não.

const PARAMETRO_INVALIDO = '22023';
const AGORA = new Date('2026-11-10T12:00:00.000Z');
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const antes = (ms: number) => new Date(AGORA.getTime() - ms);
const depois = (ms: number) => new Date(AGORA.getTime() + ms);

let banco: BancoDeTeste;
let usuario: string;
let sequencia = 0;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0016');
  const { rows } = await banco.cliente.query<{ id: string }>(
    `insert into usuario (email, nome) values ('limpeza@exemplo.com', 'Pessoa') returning id`,
  );
  usuario = rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

beforeEach(async () => {
  await banco.cliente.query('delete from token_email');
  await banco.cliente.query('delete from sessao');
});

const hash = () => {
  sequencia += 1;
  return Buffer.from(sequencia.toString(16).padStart(64, '0'), 'hex');
};

async function token(campos: { expira: Date; usado?: Date; invalidado?: Date }): Promise<string> {
  const { rows } = await banco.cliente.query<{ id: string }>(
    `insert into token_email (usuario_id, tipo, token_hash, criado_em, expira_em, usado_em,
                              invalidado_em)
     values ($1, 'confirmacao', $2, $3, $4, $5, $6) returning id`,
    [usuario, hash(), antes(HORA), campos.expira, campos.usado ?? null, campos.invalidado ?? null],
  );
  return rows[0]!.id;
}

async function sessao(campos: { criada: Date; uso: Date; encerrada?: Date }): Promise<string> {
  const { rows } = await banco.cliente.query<{ id: string }>(
    `insert into sessao (usuario_id, token_hash, criada_em, ultimo_uso_em, encerrada_em)
     values ($1, $2, $3, $4, $5) returning id`,
    [usuario, hash(), campos.criada, campos.uso, campos.encerrada ?? null],
  );
  return rows[0]!.id;
}

// Chamada como app, sem usuário na transação (o cron não tem sessão).
const vencer = (agora: Date | null = AGORA) =>
  comoRole(banco.cliente, 'app', async () => {
    const { rows } = await banco.cliente.query<{ tokens: number; sessoes: number }>(
      'select * from tarefas.vencer_tokens_e_sessoes($1)',
      [agora],
    );
    return rows[0];
  });

// Fora do rollback do comoRole: aplica e confere.
async function vencerDeVerdade(agora: Date = AGORA) {
  const { rows } = await banco.cliente.query<{ tokens: number; sessoes: number }>(
    'select * from tarefas.vencer_tokens_e_sessoes($1)',
    [agora],
  );
  return rows[0]!;
}

const linhaToken = async (id: string) =>
  (
    await banco.cliente.query(
      'select expira_em, usado_em, invalidado_em from token_email where id = $1',
      [id],
    )
  ).rows[0];

const linhaSessao = async (id: string) =>
  (
    await banco.cliente.query(
      'select criada_em, ultimo_uso_em, encerrada_em from sessao where id = $1',
      [id],
    )
  ).rows[0];

describe('catálogo: SECURITY DEFINER, search_path fixo, tipos e grants (ISO-03)', () => {
  const ASSINATURA = 'tarefas.vencer_tokens_e_sessoes(timestamptz)';

  it('é do owner, definer, com search_path fixo, parâmetro tipado e sem SQL dinâmico', async () => {
    const { rows } = await banco.cliente.query(
      `select pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                      where c = 'search_path=pg_catalog, pg_temp') as search_path_fixo,
              pg_get_function_identity_arguments(p.oid) as argumentos,
              pg_get_function_result(p.oid) as resultado,
              p.prosrc ~* '\\mexecute\\M' as sql_dinamico,
              p.prosrc ~* '\\mdelete\\M' as apaga
       from pg_proc p where p.oid = $1::regprocedure`,
      [ASSINATURA],
    );
    expect(rows).toEqual([
      {
        dono: 'owner',
        definer: true,
        search_path_fixo: true,
        argumentos: 'p_agora timestamp with time zone',
        resultado: 'TABLE(tokens integer, sessoes integer)',
        sql_dinamico: false,
        apaga: false,
      },
    ]);
  });

  it('app executa; backup_ro e PUBLIC não', async () => {
    const { rows } = await banco.cliente.query(
      `select has_function_privilege('app', $1::regprocedure, 'EXECUTE') as app,
              has_function_privilege('backup_ro', $1::regprocedure, 'EXECUTE') as backup_ro,
              exists (select 1 from aclexplode((select proacl from pg_proc
                                                where oid = $1::regprocedure)) a
                      where a.grantee = 0) as public`,
      [ASSINATURA],
    );
    expect(rows).toEqual([{ app: true, backup_ro: false, public: false }]);
  });

  it('a app continua sem DELETE e TRUNCATE em token_email e sessao', async () => {
    const { rows } = await banco.cliente.query(
      `select bool_or(has_table_privilege('app', t, 'DELETE')) as delete,
              bool_or(has_table_privilege('app', t, 'TRUNCATE')) as truncate
       from unnest(array['token_email', 'sessao']) t`,
    );
    expect(rows).toEqual([{ delete: false, truncate: false }]);
  });
});

describe('tokens de e-mail (CAD-03)', () => {
  it('aberto com expira_em antes ou igual a agora é invalidado em agora', async () => {
    const vencido = await token({ expira: antes(1) });
    const noLimite = await token({ expira: AGORA });

    expect(await vencerDeVerdade()).toEqual({ tokens: 2, sessoes: 0 });

    expect(await linhaToken(vencido)).toMatchObject({ usado_em: null, invalidado_em: AGORA });
    expect(await linhaToken(noLimite)).toMatchObject({ usado_em: null, invalidado_em: AGORA });
  });

  it('válido, usado e já invalidado ficam intactos', async () => {
    const valido = await token({ expira: depois(1) });
    const usado = await token({ expira: antes(MINUTO), usado: antes(2 * MINUTO) });
    const invalidado = await token({ expira: antes(MINUTO), invalidado: antes(3 * MINUTO) });
    const antesDe = await Promise.all([valido, usado, invalidado].map(linhaToken));

    expect(await vencerDeVerdade()).toEqual({ tokens: 0, sessoes: 0 });

    expect(await Promise.all([valido, usado, invalidado].map(linhaToken))).toEqual(antesDe);
  });

  it('não apaga nenhum token', async () => {
    await token({ expira: antes(1) });
    await token({ expira: depois(1) });
    await vencerDeVerdade();
    const { rows } = await banco.cliente.query('select count(*)::int as n from token_email');
    expect(rows[0]!.n).toBe(2);
  });
});

describe('sessões (AUTH-09)', () => {
  it('15 minutos sem uso: encerrada em agora; 1 ms antes, intacta', async () => {
    const ociosa = await sessao({ criada: antes(HORA), uso: antes(15 * MINUTO) });
    const quase = await sessao({ criada: antes(HORA), uso: antes(15 * MINUTO - 1) });

    expect(await vencerDeVerdade()).toEqual({ tokens: 0, sessoes: 1 });

    expect(await linhaSessao(ociosa)).toMatchObject({ encerrada_em: AGORA });
    expect(await linhaSessao(quase)).toMatchObject({ encerrada_em: null });
  });

  it('12 horas desde o login: encerrada mesmo com uso recente; 1 ms antes, intacta', async () => {
    const longa = await sessao({ criada: antes(12 * HORA), uso: antes(MINUTO) });
    const quase = await sessao({ criada: antes(12 * HORA - 1), uso: antes(MINUTO) });

    expect(await vencerDeVerdade()).toEqual({ tokens: 0, sessoes: 1 });

    expect(await linhaSessao(longa)).toMatchObject({ encerrada_em: AGORA });
    expect(await linhaSessao(quase)).toMatchObject({ encerrada_em: null });
  });

  it('já encerrada fica intacta', async () => {
    const encerrada = await sessao({
      criada: antes(20 * HORA),
      uso: antes(19 * HORA),
      encerrada: antes(18 * HORA),
    });
    const antesDe = await linhaSessao(encerrada);

    expect(await vencerDeVerdade()).toEqual({ tokens: 0, sessoes: 0 });

    expect(await linhaSessao(encerrada)).toEqual(antesDe);
  });
});

describe('reexecução e parâmetros', () => {
  it('a segunda execução não marca nada nem muda as datas', async () => {
    const t = await token({ expira: antes(1) });
    const s = await sessao({ criada: antes(HORA), uso: antes(20 * MINUTO) });
    await vencerDeVerdade();
    const depoisDaPrimeira = [await linhaToken(t), await linhaSessao(s)];

    expect(await vencerDeVerdade(depois(HORA))).toEqual({ tokens: 0, sessoes: 0 });

    expect([await linhaToken(t), await linhaSessao(s)]).toEqual(depoisDaPrimeira);
  });

  it('o tempo vem do parâmetro, não do relógio do banco', async () => {
    await token({ expira: new Date('2030-01-01T00:00:00.000Z') });

    expect(await vencer(new Date('2029-12-31T23:59:59.999Z'))).toEqual({ tokens: 0, sessoes: 0 });
    expect(await vencer(new Date('2030-01-01T00:00:00.000Z'))).toEqual({ tokens: 1, sessoes: 0 });
  });

  it('a app executa sem usuário na transação', async () => {
    await token({ expira: antes(1) });
    await sessao({ criada: antes(HORA), uso: antes(30 * MINUTO) });

    expect(await vencer()).toEqual({ tokens: 1, sessoes: 1 });
  });

  it('agora nulo: erro 22023', async () => {
    expect(await codigoDoErro(() => vencer(null))).toBe(PARAMETRO_INVALIDO);
  });
});
