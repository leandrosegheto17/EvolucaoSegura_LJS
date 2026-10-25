import { resolve } from 'node:path';
import pg from 'pg';
import { migrar } from '../../scripts/src/migrar.ts';
import { urlBancoAdmin } from '../vitest.urls.ts';

// globalSetup dos testes da API (roda no Node, antes do runtime do Worker): aplica as migrations
// no Postgres local (ou do CI) e libera o login da role app só neste banco de teste, para o
// binding HYPERDRIVE dos testes conectar como em produção (sujeito ao RLS). A senha 'app' é de
// teste local, como a do postgres no docker-compose; em produção o login é provisionado fora do
// repositório.
export default async function prepararBanco(): Promise<void> {
  await migrar({
    urlBanco: urlBancoAdmin,
    pasta: resolve(import.meta.dirname, '../../scripts/migrations'),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  const admin = new pg.Client({ connectionString: urlBancoAdmin });
  await admin.connect();
  try {
    await admin.query("alter role app with login password 'app'");
  } finally {
    await admin.end();
  }
}
