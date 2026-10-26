import { waitUntil } from 'cloudflare:workers';
import {
  type ColumnType,
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

// timestamptz lido como Date e gravado a partir do texto ISO 8601 do contrato.
type Instante = ColumnType<Date, string, string>;

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
  // Perfil (migration 0005): RLS forçada; a app nunca troca o dono da linha.
  perfil: {
    id: Generated<string>;
    usuario_id: string;
    nome: string;
    contato: string | null;
    endereco: string | null;
    atende_sabado: Generated<boolean>;
    atende_domingo: Generated<boolean>;
    especialidade: 'psicologia' | 'nutricao' | 'fisioterapia' | 'outra' | null;
    especialidade_nome: string | null;
    conselho: string | null;
    numero_registro: string | null;
    regiao: string | null;
    row_version: Generated<number>;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
  configuracao_usuario: {
    id: Generated<string>;
    usuario_id: string;
    privacidade_agenda: Generated<boolean>;
    row_version: Generated<number>;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
  // Pacientes (migration 0006): RLS forçada; a app cria e troca só `ativo`; TCLE só de inclusão.
  paciente: {
    id: Generated<string>;
    usuario_id: string;
    nome: string;
    telefone: string | null;
    email: string | null;
    endereco: string | null;
    ativo: Generated<boolean>;
    row_version: Generated<number>;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
  consentimento_tcle: {
    id: Generated<string>;
    usuario_id: string;
    paciente_id: string;
    finalidade: string;
    data_consentimento: string;
    versao_termo: string;
    criado_em: Generated<Date>;
  };
  // Agenda (migration 0007): RLS forçada; nada é apagado; a sessão nasce agendada.
  serie_recorrencia: {
    id: Generated<string>;
    usuario_id: string;
    paciente_id: string;
    frequencia: 'semanal' | 'quinzenal';
    ocorrencias: number;
    cancelada: Generated<boolean>;
    row_version: Generated<number>;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
  sessao_atendimento: {
    id: Generated<string>;
    usuario_id: string;
    paciente_id: string;
    serie_id: string | null;
    inicio: Instante;
    fim: Instante;
    link: string | null;
    status: Generated<'agendada' | 'realizada' | 'faltou' | 'cancelada' | 'remarcada'>;
    cobravel: Generated<boolean>;
    row_version: Generated<number>;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
  // Anamnese (migration 0008): RLS forçada; nada é apagado; retificação só de inclusão; a
  // anamnese só muda no dia do cadastro (trigger, ES002).
  modelo_anamnese: {
    id: Generated<string>;
    usuario_id: string;
    especialidade: 'psicologia' | 'nutricao' | 'fisioterapia' | 'outra';
    revisao: Generated<number>;
    row_version: Generated<number>;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
  modelo_anamnese_item: {
    id: Generated<string>;
    usuario_id: string;
    modelo_id: string;
    tipo: 'campo' | 'alerta';
    especial: Generated<boolean>;
    rotulo: string;
    ordem: number;
    revisao_inclusao: number;
    removido: Generated<boolean>;
    row_version: Generated<number>;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
  anamnese: {
    id: Generated<string>;
    usuario_id: string;
    paciente_id: string;
    modelo_id: string;
    data_sessao: string;
    modelo_revisao: number;
    valores: Generated<unknown>;
    row_version: Generated<number>;
    criado_em: Generated<Date>;
    atualizado_em: Generated<Date>;
  };
  anamnese_retificacao: {
    id: Generated<string>;
    usuario_id: string;
    anamnese_id: string;
    seq: number;
    motivo: string;
    modelo_revisao: number;
    valores: unknown;
    criado_em: Generated<Date>;
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
