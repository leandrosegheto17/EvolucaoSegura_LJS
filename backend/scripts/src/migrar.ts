import { resolve } from 'node:path';
import { runner } from 'node-pg-migrate';

// OPS-05: aplica as migrations de backend/scripts/migrations com o node-pg-migrate. Uma migration
// por arquivo, todas na mesma transação: se uma falhar, nenhuma fica aplicada. Reaplicar só roda
// o que ainda não consta na tabela pgmigrations.

type Logger = NonNullable<Parameters<typeof runner>[0]['logger']>;

export interface OpcoesMigrar {
  urlBanco: string;
  pasta: string;
  logger?: Logger;
}

// Devolve os nomes das migrations aplicadas nesta execução, na ordem.
export async function migrar({ urlBanco, pasta, logger }: OpcoesMigrar): Promise<string[]> {
  const aplicadas = await runner({
    databaseUrl: urlBanco,
    dir: pasta,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    singleTransaction: true,
    checkOrder: true,
    ...(logger ? { logger } : {}),
  });
  return aplicadas.map((migration) => migration.name);
}

// `pnpm migrar`: DATABASE_URL (a URL da role owner em produção); sem ela usa o Postgres local.
if (import.meta.main) {
  const urlBanco =
    process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/evolucao_segura';
  const pasta = resolve(import.meta.dirname, '../migrations');
  const aplicadas = await migrar({ urlBanco, pasta });
  process.stdout.write(`Migrations aplicadas nesta execução: ${aplicadas.length}\n`);
}
