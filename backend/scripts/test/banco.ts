import { resolve } from 'node:path';
import pg from 'pg';
import { migrar } from '../src/migrar.ts';

// Apoio dos testes de garantia do banco: cria um banco novo no Postgres local (ou do CI), aplica
// as migrations reais de backend/scripts/migrations e o apaga no fim. As roles são do cluster,
// então os testes as assumem com SET ROLE a partir da conexão de superusuário.

const urlBase =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5433/evolucao_segura';
const semLog = { info: () => {}, warn: () => {}, error: () => {} };
export const pastaMigrations = resolve(import.meta.dirname, '../migrations');

export const urlComBanco = (banco: string): string => {
  const url = new URL(urlBase);
  url.pathname = `/${banco}`;
  return url.toString();
};

export interface BancoDeTeste {
  url: string;
  cliente: pg.Client;
  apagar: () => Promise<void>;
}

export async function criarBancoMigrado(prefixo: string): Promise<BancoDeTeste> {
  const nome = `es_${prefixo}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: urlComBanco('postgres') });
  await admin.connect();
  await admin.query(`create database ${nome}`);
  const url = urlComBanco(nome);
  await migrar({ urlBanco: url, pasta: pastaMigrations, logger: semLog });
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  return {
    url,
    cliente,
    apagar: async () => {
      await cliente.end();
      await admin.query(`drop database if exists ${nome} with (force)`);
      await admin.end();
    },
  };
}

// Roda `fn` numa transação desfeita no fim, já com a role e o app.usuario_id pedidos.
export async function comoRole<T>(
  cliente: pg.Client,
  role: string | null,
  fn: () => Promise<T>,
  usuarioId?: string,
): Promise<T> {
  await cliente.query('begin');
  try {
    if (usuarioId !== undefined)
      await cliente.query("select set_config('app.usuario_id', $1, true)", [usuarioId]);
    if (role !== null) await cliente.query(`set local role "${role}"`);
    return await fn();
  } finally {
    await cliente.query('rollback');
  }
}

// Código SQLSTATE do erro lançado por `fn` (ou null se não lançar).
export async function codigoDoErro(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (erro) {
    return (erro as { code?: string }).code ?? 'sem-codigo';
  }
}
