import { waitUntil } from 'cloudflare:workers';
import {
  type Generated,
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

// Tabelas vistas pelo Kysely; cada etapa acrescenta as suas (migrations em backend/scripts).
export interface Banco {
  audit_log: {
    id: Generated<string>;
    usuario_id: string;
    ator: string;
    acao: string;
    alvo_tipo: string;
    alvo_id: string | null;
    campos_alterados: Generated<string[]>;
    origem_ip: string | null;
    origem_ua: string | null;
    criado_em: Generated<Date>;
  };
  // Identidade (migration 0003): sem RLS, com grants por coluna; a app nunca lê credencial_senha.
  usuario: {
    id: Generated<string>;
    email: string;
    nome: string;
    confirmado_em: Date | null;
    bloqueado_exclusao_em: Date | null;
    criado_em: Generated<Date>;
  };
  token_email: {
    id: Generated<string>;
    usuario_id: string;
    tipo: 'confirmacao' | 'recuperacao' | 'exclusao' | 'desistencia';
    token_hash: Buffer;
    criado_em: Generated<Date>;
    expira_em: Date;
    usado_em: Date | null;
    invalidado_em: Date | null;
  };
  sessao: {
    id: Generated<string>;
    usuario_id: string;
    token_hash: Buffer;
    criada_em: Generated<Date>;
    ultimo_uso_em: Generated<Date>;
    encerrada_em: Date | null;
  };
  desafio_2fa: {
    id: Generated<string>;
    usuario_id: string;
    codigo_hmac: Buffer;
    criado_em: Generated<Date>;
    expira_em: Date;
    erros: Generated<number>;
    usado_em: Date | null;
    invalidado_em: Date | null;
  };
  tentativa_login: {
    tipo: 'email' | 'ip';
    chave_hash: Buffer;
    falhas: Generated<number>;
    janela_inicio: Date | null;
    bloqueado_ate: Date | null;
  };
  aceite_termos: {
    id: Generated<string>;
    usuario_id: string;
    versao_termos: string;
    versao_privacidade: string;
    aceito_em: Generated<Date>;
  };
  // Cobrança (migration 0004): RLS forçada.
  assinatura: {
    usuario_id: string;
    plano: 'pro' | 'free';
    status: 'trial' | 'ativa' | 'atrasada' | 'cancelada' | 'free';
    asaas_customer_id: string | null;
    asaas_subscription_id: string | null;
    periodo_fim: Date;
    vencimento_atraso: Date | null;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
}

export type Trx = Transaction<Banco>;

// Pool de um cliente só: o Kysely usa sempre a conexão desta requisição.
function poolDeUmCliente(cliente: pg.Client): PostgresPool {
  const conexao: PostgresPoolClient = {
    query: cliente.query.bind(cliente) as PostgresPoolClient['query'],
    release: () => {},
  };
  return { connect: async () => conexao, end: async () => {}, options: {} };
}

// Rotas públicas que descobrem o usuário no meio da transação (ex.: pelo token do link de
// confirmação) passam a valer para o RLS a partir daqui, só nesta transação.
export async function definirUsuarioDaTransacao(trx: Trx, usuarioId: string): Promise<void> {
  await sql`select set_config('app.usuario_id', ${usuarioId}, true)`.execute(trx);
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
      if (usuarioId !== null) await definirUsuarioDaTransacao(trx, usuarioId);
      return fn(trx);
    });
  } finally {
    waitUntil(cliente.end());
  }
}
