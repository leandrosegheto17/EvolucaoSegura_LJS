import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T152 / CONTA-05, ISO-03 (ADR-005): migration 0023, tarefas.purgar_contas(agora, limite).
// - 30 dias (720 horas) depois da confirmação (bloqueado_exclusao_em) sem desistência, apaga todas
//   as linhas do profissional, auditoria inclusive, e guarda só conta_excluida (id, data do
//   pedido, data da purga). Antes de 30 dias nada é apagado; conta não bloqueada nunca.
// - Data do pedido: o último conta.exclusao_pedida até o bloqueio (sem ele, a data do bloqueio).
//   Data da purga: o agora da execução.
// - Tabelas só de inclusão seguem barrando UPDATE, TRUNCATE e DELETE fora da purga (ES001).
// - Outro profissional intacto; reexecução não muda nada; limite e parâmetros validados.
// SECURITY DEFINER do owner, search_path fixo, sem SET app.* na definição (Neon); app executa,
// backup_ro e PUBLIC não.

const PARAMETRO_INVALIDO = '22023';
const SO_INCLUSAO = 'ES001';
const AGORA = new Date('2026-01-10T12:00:00.000Z');
const HORA = 60 * 60_000;
const DIA = 24 * HORA;
const TRINTA_DIAS = 30 * DIA;
const antes = (ms: number) => new Date(AGORA.getTime() - ms);

let banco: BancoDeTeste;
let sequencia = 0;

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

beforeAll(async () => {
  banco = await criarBancoMigrado('m0023');
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

beforeEach(async () => {
  // Só desbloqueia o que sobrou: nada fica elegível de um teste para o outro.
  await consultar('update usuario set bloqueado_exclusao_em = null');
});

const hash = () => {
  sequencia += 1;
  return Buffer.from(sequencia.toString(16).padStart(64, '0'), 'hex');
};

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest();

interface Conta {
  id: string;
  email: string;
}

// Conta com linhas em tabelas de identidade, de negócio e só de inclusão (TCLE e auditoria). O
// bloqueio vem por último, como na confirmação.
async function conta(bloqueio: Date | null, pedido: Date | null = null): Promise<Conta> {
  sequencia += 1;
  const email = `pessoa${sequencia}@exemplo.com`;
  const [u] = await consultar<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em) values ($1, 'Ana Souza', now()) returning id`,
    [email],
  );
  const id = u!.id;
  await consultar(
    `insert into credencial_senha (usuario_id, hash) values ($1, '$2a$04$' || repeat('a', 53))`,
    [id],
  );
  await consultar(
    `insert into token_email (usuario_id, tipo, token_hash, expira_em)
     values ($1, 'desistencia', $2, now() + interval '1 day')`,
    [id, hash()],
  );
  await consultar(`insert into sessao (usuario_id, token_hash) values ($1, $2)`, [id, hash()]);
  await consultar(
    `insert into tentativa_login (tipo, chave_hash, falhas) values ('email', $1, 1)`,
    [sha256(email)],
  );
  const [p] = await consultar<{ id: string }>(
    `insert into paciente (usuario_id, nome) values ($1, 'Paciente') returning id`,
    [id],
  );
  await consultar(
    `insert into consentimento_tcle (usuario_id, paciente_id, finalidade, data_consentimento,
                                     versao_termo)
     values ($1, $2, 'atendimento', '2025-01-01', '1.0')`,
    [id, p!.id],
  );
  await consultar(
    `insert into audit_log (usuario_id, ator, acao, alvo_tipo) values ($1::text::uuid, $1::text, 'auth.login_ok', 'auth')`,
    [id],
  );
  if (pedido)
    await consultar(
      `insert into audit_log (usuario_id, ator, acao, alvo_tipo, criado_em)
       values ($1::text::uuid, $1::text, 'conta.exclusao_pedida', 'conta', $2)`,
      [id, pedido],
    );
  if (bloqueio)
    await consultar('update usuario set bloqueado_exclusao_em = $2 where id = $1', [id, bloqueio]);
  return { id, email };
}

const purgar = async (agora: Date | null = AGORA, limite: number | null = 10) =>
  (await consultar<{ n: number }>('select tarefas.purgar_contas($1, $2) as n', [agora, limite]))[0]!
    .n;

// Linhas da conta nas tabelas semeadas (superusuário: ignora o RLS).
async function linhasDe(c: Conta): Promise<Record<string, number>> {
  const [r] = await consultar<Record<string, number>>(
    `select (select count(*)::int from usuario where id = $1) as usuario,
            (select count(*)::int from credencial_senha where usuario_id = $1) as credencial,
            (select count(*)::int from token_email where usuario_id = $1) as tokens,
            (select count(*)::int from sessao where usuario_id = $1) as sessoes,
            (select count(*)::int from paciente where usuario_id = $1) as pacientes,
            (select count(*)::int from consentimento_tcle where usuario_id = $1) as tcle,
            (select count(*)::int from audit_log where usuario_id = $1) as auditoria,
            (select count(*)::int from tentativa_login where tipo = 'email' and chave_hash = $2)
              as tentativa`,
    [c.id, sha256(c.email)],
  );
  return r!;
}

const NADA = {
  usuario: 0,
  credencial: 0,
  tokens: 0,
  sessoes: 0,
  pacientes: 0,
  tcle: 0,
  auditoria: 0,
  tentativa: 0,
};

const excluida = (id: string) =>
  consultar<{ id: string; pedido_em: Date; purgado_em: Date }>(
    'select * from conta_excluida where id = $1',
    [id],
  );

describe('catálogo: SECURITY DEFINER, search_path fixo e grants (ISO-03)', () => {
  const ASSINATURA = 'tarefas.purgar_contas(timestamptz, integer)';

  it('é do owner, definer, com search_path fixo, sem SET app.* nem SQL dinâmico', async () => {
    const linhas = await consultar(
      `select pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer, p.proconfig as config,
              pg_get_function_identity_arguments(p.oid) as argumentos,
              pg_get_function_result(p.oid) as resultado,
              p.prosrc ~* '\\mexecute\\M' as sql_dinamico
       from pg_proc p where p.oid = $1::regprocedure`,
      [ASSINATURA],
    );
    expect(linhas).toEqual([
      {
        dono: 'owner',
        definer: true,
        config: ['search_path=pg_catalog, pg_temp'],
        argumentos: 'p_agora timestamp with time zone, p_limite integer',
        resultado: 'integer',
        sql_dinamico: false,
      },
    ]);
  });

  it('app executa; backup_ro e PUBLIC não', async () => {
    const linhas = await consultar(
      `select has_function_privilege('app', $1::regprocedure, 'EXECUTE') as app,
              has_function_privilege('backup_ro', $1::regprocedure, 'EXECUTE') as backup_ro,
              exists (select 1 from aclexplode((select proacl from pg_proc
                                                where oid = $1::regprocedure)) a
                      where a.grantee = 0) as public`,
      [ASSINATURA],
    );
    expect(linhas).toEqual([{ app: true, backup_ro: false, public: false }]);
  });

  it('a app continua sem DELETE em conta_excluida, usuario e audit_log', async () => {
    const linhas = await consultar(
      `select bool_or(has_table_privilege('app', t, 'DELETE')) as delete,
              bool_or(has_table_privilege('app', 'conta_excluida', p)) as conta_excluida
       from unnest(array['conta_excluida', 'usuario', 'audit_log']) t,
            unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p`,
    );
    expect(linhas).toEqual([{ delete: false, conta_excluida: false }]);
  });

  it('agora nulo ou limite fora de 1 a 1000: 22023', async () => {
    expect(await codigoDoErro(() => purgar(null))).toBe(PARAMETRO_INVALIDO);
    expect(await codigoDoErro(() => purgar(AGORA, null))).toBe(PARAMETRO_INVALIDO);
    expect(await codigoDoErro(() => purgar(AGORA, 0))).toBe(PARAMETRO_INVALIDO);
    expect(await codigoDoErro(() => purgar(AGORA, 1001))).toBe(PARAMETRO_INVALIDO);
  });
});

describe('antes de 30 dias nada é apagado (CONTA-05)', () => {
  it('bloqueada há 30 dias menos 1 ms: intacta e sem conta_excluida', async () => {
    const c = await conta(antes(TRINTA_DIAS - 1), antes(TRINTA_DIAS + HORA));
    const antesDe = await linhasDe(c);

    expect(await purgar()).toBe(0);

    expect(await linhasDe(c)).toEqual(antesDe);
    expect(antesDe).toEqual({
      usuario: 1,
      credencial: 1,
      tokens: 1,
      sessoes: 1,
      pacientes: 1,
      tcle: 1,
      auditoria: 2,
      tentativa: 1,
    });
    expect(await excluida(c.id)).toEqual([]);
  });

  it('conta não bloqueada nunca é purgada', async () => {
    const c = await conta(null);
    const antesDe = await linhasDe(c);
    expect(await purgar(new Date('2100-01-01T00:00:00.000Z'))).toBe(0);
    expect(await linhasDe(c)).toEqual(antesDe);
  });
});

describe('depois de 30 dias: apaga tudo e guarda só conta_excluida (CONTA-05)', () => {
  it('exatamente 30 dias: apaga as linhas do profissional, auditoria inclusive', async () => {
    const c = await conta(antes(TRINTA_DIAS), antes(TRINTA_DIAS + HORA));

    expect(await purgar()).toBe(1);

    expect(await linhasDe(c)).toEqual(NADA);
  });

  it('conta_excluida com id, data do pedido e data da purga', async () => {
    const bloqueio = antes(40 * DIA);
    const pedido = antes(40 * DIA + 10 * 60_000);
    const c = await conta(bloqueio, pedido);

    await purgar();

    expect(await excluida(c.id)).toEqual([{ id: c.id, pedido_em: pedido, purgado_em: AGORA }]);
  });

  it('data do pedido é o último pedido até o bloqueio', async () => {
    const bloqueio = antes(35 * DIA);
    const c = await conta(null, antes(36 * DIA));
    const ultimo = antes(35 * DIA + 5 * 60_000);
    await consultar(
      `insert into audit_log (usuario_id, ator, acao, alvo_tipo, criado_em)
       values ($1::text::uuid, $1::text, 'conta.exclusao_pedida', 'conta', $2)`,
      [c.id, ultimo],
    );
    await consultar('update usuario set bloqueado_exclusao_em = $2 where id = $1', [
      c.id,
      bloqueio,
    ]);

    await purgar();

    expect((await excluida(c.id))[0]?.pedido_em).toEqual(ultimo);
  });

  it('sem evento de pedido, a data do pedido é a do bloqueio', async () => {
    const bloqueio = antes(31 * DIA);
    const c = await conta(bloqueio);

    await purgar();

    expect(await excluida(c.id)).toEqual([{ id: c.id, pedido_em: bloqueio, purgado_em: AGORA }]);
  });

  it('não guarda dado pessoal: conta_excluida só tem id e as duas datas', async () => {
    const c = await conta(antes(31 * DIA));
    await purgar();
    const [linha] = await consultar<Record<string, unknown>>(
      'select row_to_json(e)::text as texto from conta_excluida e where id = $1',
      [c.id],
    );
    expect(String(linha!['texto'])).not.toContain(c.email);
    expect(String(linha!['texto'])).not.toContain('Ana Souza');
  });

  it('outro profissional fica intacto, inclusive a tentativa de login do e-mail dele', async () => {
    const outro = await conta(null);
    const recente = await conta(antes(DIA));
    const retratos = [await linhasDe(outro), await linhasDe(recente)];
    const ip = hash();
    await consultar(`insert into tentativa_login (tipo, chave_hash, falhas) values ('ip', $1, 1)`, [
      ip,
    ]);
    const c = await conta(antes(31 * DIA));

    expect(await purgar()).toBe(1);

    expect(await linhasDe(c)).toEqual(NADA);
    expect([await linhasDe(outro), await linhasDe(recente)]).toEqual(retratos);
    expect(
      await consultar(`select falhas from tentativa_login where tipo = 'ip' and chave_hash = $1`, [
        ip,
      ]),
    ).toEqual([{ falhas: 1 }]);
  });

  it('reexecução é inofensiva: nada muda na segunda vez', async () => {
    const c = await conta(antes(31 * DIA));
    expect(await purgar()).toBe(1);
    const depoisDaPrimeira = await excluida(c.id);

    expect(await purgar(new Date(AGORA.getTime() + DIA))).toBe(0);

    expect(await excluida(c.id)).toEqual(depoisDaPrimeira);
    expect(await linhasDe(c)).toEqual(NADA);
  });

  it('respeita o limite, das bloqueadas há mais tempo para as mais recentes', async () => {
    const velha = await conta(antes(50 * DIA));
    const meio = await conta(antes(40 * DIA));
    const nova = await conta(antes(31 * DIA));

    expect(await purgar(AGORA, 2)).toBe(2);

    expect((await linhasDe(velha)).usuario).toBe(0);
    expect((await linhasDe(meio)).usuario).toBe(0);
    expect((await linhasDe(nova)).usuario).toBe(1);
    expect(await purgar(AGORA, 2)).toBe(1);
  });

  it('chamada pela app (sem usuário na transação) e devolve o contexto da transação', async () => {
    const c = await conta(antes(31 * DIA));
    const contexto = await comoRole(banco.cliente, 'app', async () => {
      const [r] = await consultar<{ n: number }>('select tarefas.purgar_contas($1, 10) as n', [
        AGORA,
      ]);
      const [cfg] = await consultar<{ usuario: string | null; purga: string | null }>(
        `select nullif(current_setting('app.usuario_id', true), '') as usuario,
                nullif(current_setting('app.purga_usuario', true), '') as purga`,
      );
      return { n: r!.n, ...cfg };
    });
    // comoRole desfaz a transação: a conta continua lá.
    expect(contexto).toEqual({ n: 1, usuario: null, purga: null });
    expect((await linhasDe(c)).usuario).toBe(1);
  });
});

describe('tabelas só de inclusão continuam barradas fora da purga (ES001)', () => {
  const tentarApagar = (usuarioId: string, purga: string | null) =>
    comoRole(
      banco.cliente,
      'owner',
      async () => {
        if (purga !== null)
          await consultar("select set_config('app.purga_usuario', $1, true)", [purga]);
        return codigoDoErro(() =>
          consultar('delete from consentimento_tcle where usuario_id = $1', [usuarioId]),
        );
      },
      usuarioId,
    );

  it('DELETE sem a purga em curso, mesmo com a conta bloqueada há 30 dias', async () => {
    const c = await conta(antes(31 * DIA));
    expect(await tentarApagar(c.id, null)).toBe(SO_INCLUSAO);
  });

  it('DELETE com a variável da purga, mas conta bloqueada há menos de 30 dias', async () => {
    const c = await conta(new Date(Date.now() - TRINTA_DIAS + HORA));
    expect(await tentarApagar(c.id, c.id)).toBe(SO_INCLUSAO);
  });

  it('DELETE com a variável da purga, mas conta não bloqueada', async () => {
    const c = await conta(null);
    expect(await tentarApagar(c.id, c.id)).toBe(SO_INCLUSAO);
  });

  it('DELETE com a variável de outra conta', async () => {
    const c = await conta(antes(31 * DIA));
    const outra = await conta(antes(31 * DIA));
    expect(await tentarApagar(c.id, outra.id)).toBe(SO_INCLUSAO);
  });

  it('UPDATE e TRUNCATE seguem barrados mesmo durante a purga', async () => {
    const c = await conta(antes(31 * DIA));
    const codigos = await comoRole(
      banco.cliente,
      'owner',
      async () => {
        await consultar("select set_config('app.purga_usuario', $1, true)", [c.id]);
        return [
          await codigoDoErro(() =>
            consultar(`update audit_log set acao = 'auth.logout' where usuario_id = $1`, [c.id]),
          ),
        ];
      },
      c.id,
    );
    const truncate = await comoRole(banco.cliente, 'owner', async () => {
      await consultar("select set_config('app.purga_usuario', $1, true)", [c.id]);
      return codigoDoErro(() => consultar('truncate audit_log'));
    });
    expect([...codigos, truncate]).toEqual([SO_INCLUSAO, SO_INCLUSAO]);
  });
});
