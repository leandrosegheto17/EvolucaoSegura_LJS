import { env } from 'cloudflare:workers';
import { sql } from 'kysely';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { comTransacao, TEMPO_LIMITE_CONEXAO_MS } from '../src/db.ts';

// T32 / ISO-01: uma transação por requisição, com o usuário definido por
// set_config('app.usuario_id', $1, true) (spike set-local-hyperdrive). O contexto não vaza para a
// requisição seguinte, erro faz ROLLBACK e, sem usuário, nada de tabela com RLS fica visível.
// HYPERDRIVE conecta como a role app (vitest.config.ts); HYPERDRIVE_ADMIN é o superusuário de teste.

const admin = (env as unknown as { HYPERDRIVE_ADMIN: Hyperdrive }).HYPERDRIVE_ADMIN;

async function comoAdmin<T extends pg.QueryResultRow>(
  consulta: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  const cliente = new pg.Client({ connectionString: admin.connectionString });
  cliente.on('error', () => {});
  await cliente.connect();
  try {
    return (await cliente.query<T>(consulta, parametros)).rows;
  } finally {
    await cliente.end();
  }
}

const novoId = (): string => crypto.randomUUID();

const usuarioDaTransacao = (usuarioId: string | null) =>
  comTransacao(env, usuarioId, async (trx) => {
    const { rows } = await sql<{
      id: string | null;
    }>`select app_usuario_id() as id`.execute(trx);
    return rows[0]?.id ?? null;
  });

async function registrarEvento(usuarioId: string, alvoId: string): Promise<void> {
  await comTransacao(env, usuarioId, async (trx) => {
    await sql`insert into audit_log (usuario_id, ator, acao, alvo_tipo, alvo_id)
      values (${usuarioId}, ${usuarioId}, 'auth.login_ok', 'conta', ${alvoId})`.execute(trx);
  });
}

describe('comTransacao', () => {
  it('conecta como a role app, sujeita ao RLS', async () => {
    const papel = await comTransacao(env, null, async (trx) => {
      const { rows } = await sql<{ papel: string }>`select current_user as papel`.execute(trx);
      return rows[0]?.papel;
    });
    expect(papel).toBe('app');
  });

  it('define app.usuario_id dentro da transação', async () => {
    const usuario = novoId();
    expect(await usuarioDaTransacao(usuario)).toBe(usuario);
  });

  it('passa o usuário como parâmetro do set_config, nunca interpolado no SQL', async () => {
    const valorComAspas = "x'; set role postgres; --";
    const lido = await comTransacao(env, valorComAspas, async (trx) => {
      const { rows } = await sql<{
        valor: string;
      }>`select current_setting('app.usuario_id') as valor`.execute(trx);
      return rows[0]?.valor;
    });
    expect(lido).toBe(valorComAspas);
  });

  it('o contexto do usuário não vaza para a requisição seguinte', async () => {
    const usuario = novoId();
    expect(await usuarioDaTransacao(usuario)).toBe(usuario);
    expect(await usuarioDaTransacao(null)).toBeNull();
  });

  it('requisições simultâneas de usuários diferentes não se misturam', async () => {
    const usuarios = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? novoId() : null));
    const lidos = await Promise.all(usuarios.map((usuario) => usuarioDaTransacao(usuario)));
    expect(lidos).toEqual(usuarios);
  });

  it('erro dentro da função faz ROLLBACK e propaga o erro', async () => {
    const usuario = novoId();
    const alvo = novoId();
    const falha = new Error('falha no meio da requisição');

    await expect(
      comTransacao(env, usuario, async (trx) => {
        await sql`insert into audit_log (usuario_id, ator, acao, alvo_tipo, alvo_id)
          values (${usuario}, ${usuario}, 'auth.login_ok', 'conta', ${alvo})`.execute(trx);
        throw falha;
      }),
    ).rejects.toBe(falha);

    expect(await comoAdmin('select id from audit_log where alvo_id = $1', [alvo])).toEqual([]);
  });

  it('sem erro faz COMMIT', async () => {
    const usuario = novoId();
    const alvo = novoId();
    await registrarEvento(usuario, alvo);

    expect(await comoAdmin('select usuario_id from audit_log where alvo_id = $1', [alvo])).toEqual([
      { usuario_id: usuario },
    ]);
  });

  it('sem usuário, nenhuma linha de tabela com RLS fica visível', async () => {
    const usuario = novoId();
    await registrarEvento(usuario, novoId());

    const visiveis = await comTransacao(env, null, async (trx) => {
      const { rows } = await sql<{
        total: string;
      }>`select count(*)::text as total from audit_log`.execute(trx);
      return rows[0]?.total;
    });
    expect(visiveis).toBe('0');
  });

  it('com usuário, só as linhas dele ficam visíveis', async () => {
    const a = novoId();
    const b = novoId();
    await registrarEvento(a, novoId());
    await registrarEvento(b, novoId());

    const donos = await comTransacao(env, a, async (trx) => {
      const { rows } = await sql<{ usuario_id: string }>`select distinct usuario_id from audit_log
        where usuario_id in (${a}, ${b})`.execute(trx);
      return rows.map((linha) => linha.usuario_id);
    });
    expect(donos).toEqual([a]);
  });
});

// Padrão Neon, item 5: a conexão tem tempo limite de 8 s e não há nova tentativa.
describe('comTransacao: tempo limite da conexão', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abre o pg.Client com connectionTimeoutMillis de 8 s', async () => {
    const criar = vi.spyOn(pg, 'Client');

    await comTransacao(env, null, async () => null);

    expect(TEMPO_LIMITE_CONEXAO_MS).toBe(8_000);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(criar.mock.calls[0]?.[0]).toMatchObject({ connectionTimeoutMillis: 8_000 });
  });

  it('sem retry: conexão recusada falha na primeira tentativa, sem chamar fn', async () => {
    const criar = vi.spyOn(pg, 'Client');
    const fn = vi.fn(async () => null);
    const semBanco = { HYPERDRIVE: { connectionString: 'postgres://x:x@127.0.0.1:1/x' } };

    await expect(comTransacao(semBanco as never, null, fn)).rejects.toThrow();

    expect(criar).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
  });
});
