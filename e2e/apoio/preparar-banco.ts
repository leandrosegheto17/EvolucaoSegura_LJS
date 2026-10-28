import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { migrar } from '../../backend/scripts/src/migrar.ts';
import { BANCO_E2E, RAIZ, URL_BANCO_ADMIN } from './config.ts';

// OPS-05: Postgres do docker-compose no ar, banco do e2e criado, migrations aplicadas e login da
// role evolucao_app liberado (como o globalSetup dos testes da API).
export async function prepararBanco(): Promise<void> {
  const subir = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'postgres'], {
    cwd: RAIZ,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (subir.status !== 0) throw new Error('docker compose up -d postgres falhou');

  const servidor = new pg.Client({
    connectionString: URL_BANCO_ADMIN.replace(`/${BANCO_E2E}`, '/postgres'),
  });
  await servidor.connect();
  try {
    const existe = await servidor.query('select 1 from pg_database where datname = $1', [
      BANCO_E2E,
    ]);
    if (existe.rowCount === 0) await servidor.query(`create database ${BANCO_E2E}`);
  } finally {
    await servidor.end();
  }

  await migrar({
    urlBanco: URL_BANCO_ADMIN,
    pasta: resolve(RAIZ, 'backend/scripts/migrations'),
    logger: { info: () => {}, warn: console.warn, error: console.error },
  });
  const admin = new pg.Client({ connectionString: URL_BANCO_ADMIN });
  await admin.connect();
  try {
    await admin.query("alter role evolucao_app with login password 'evolucao_app'");
  } finally {
    await admin.end();
  }
}
