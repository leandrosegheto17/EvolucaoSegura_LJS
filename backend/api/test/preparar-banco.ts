import { resolve } from 'node:path';
import pg from 'pg';
import { migrar } from '../../scripts/src/migrar.ts';
import { exigirHostLocal } from '../../scripts/src/seguranca/trava-host.ts';
import { urlBancoAdmin } from '../vitest.urls.ts';

// globalSetup dos testes da API (roda no Node, antes do runtime do Worker): aplica as migrations
// no Postgres local (ou do CI) e libera o login da role app só neste banco de teste, para o
// binding HYPERDRIVE dos testes conectar como em produção (sujeito ao RLS). A senha 'app' é de
// teste local, como a do postgres no docker-compose; em produção o login é provisionado fora do
// repositório. Trava de host: só o Postgres local; a troca de senha de role nunca chega a um
// banco remoto (no Neon, mudaria a senha da role do app de produção).
export async function prepararBancoEm(urlAdmin: string): Promise<void> {
  exigirHostLocal(urlAdmin);
  await migrar({
    urlBanco: urlAdmin,
    pasta: resolve(import.meta.dirname, '../../scripts/migrations'),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  const admin = new pg.Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    await admin.query("alter role app with login password 'app'");
  } finally {
    await admin.end();
  }
}

// O Vitest chama o globalSetup com o projeto como argumento: a URL vem sempre do vitest.urls.ts.
export default async function prepararBanco(): Promise<void> {
  await prepararBancoEm(urlBancoAdmin);
}
