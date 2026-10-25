import { waitUntil } from 'cloudflare:workers';
import {
  Kysely,
  PostgresDialect,
  type PostgresPool,
  type PostgresPoolClient,
  sql,
  type Transaction,
} from 'kysely';
import pg from 'pg';

// ISO-01: uma transação por requisição. Um pg.Client novo por requisição pelo Hyperdrive
// (recomendação da Cloudflare), envolvido pelo Kysely. O usuário entra com
// set_config('app.usuario_id', $1, true): o "true" faz valer só nesta transação (equivale ao
// SET LOCAL, que não aceita parâmetro). Sem usuário (rotas públicas), app_usuario_id() fica nulo
// e o RLS não mostra nenhuma linha. Spike set-local-hyperdrive.

// Tabelas vistas pelo Kysely; cada etapa acrescenta as suas.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Banco {}

export type Trx = Transaction<Banco>;

// Pool de um cliente só: o Kysely usa sempre a conexão desta requisição.
function poolDeUmCliente(cliente: pg.Client): PostgresPool {
  const conexao: PostgresPoolClient = {
    query: cliente.query.bind(cliente) as PostgresPoolClient['query'],
    release: () => {},
  };
  return { connect: async () => conexao, end: async () => {}, options: {} };
}

export async function comTransacao<T>(
  env: Pick<Cloudflare.Env, 'HYPERDRIVE'>,
  usuarioId: string | null,
  fn: (trx: Trx) => Promise<T>,
): Promise<T> {
  const cliente = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  // O pg-cloudflare emite 'error' ao ler do socket que acabou de fechar; sem ouvinte o runtime
  // trata como exceção não tratada. Falha de consulta continua rejeitando a promessa.
  cliente.on('error', () => {});
  await cliente.connect();
  try {
    const db = new Kysely<Banco>({
      dialect: new PostgresDialect({ pool: poolDeUmCliente(cliente) }),
    });
    // O Kysely faz BEGIN, COMMIT no retorno e ROLLBACK quando fn lança.
    return await db.transaction().execute(async (trx) => {
      if (usuarioId !== null)
        await sql`select set_config('app.usuario_id', ${usuarioId}, true)`.execute(trx);
      return fn(trx);
    });
  } finally {
    waitUntil(cliente.end());
  }
}
