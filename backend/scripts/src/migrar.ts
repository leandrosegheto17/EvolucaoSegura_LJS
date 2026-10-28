import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { runner } from 'node-pg-migrate';
import { UrlNeonRecusada, validarUrlNeon } from './neon/url-neon.ts';
import { type Alvo, eAlvo, exigirHostPermitido, HostRecusado } from './seguranca/trava-host.ts';

// OPS-05: aplica as migrations de backend/scripts/migrations com o node-pg-migrate. Uma migration
// por arquivo, todas na mesma transação: se uma falhar, nenhuma fica aplicada. Reaplicar só roda
// o que ainda não consta na tabela pgmigrations.

type Logger = NonNullable<Parameters<typeof runner>[0]['logger']>;

export interface OpcoesMigrar {
  urlBanco: string;
  pasta: string;
  logger?: Logger;
  // Trava de host (seguranca/trava-host.ts): banco remoto só com alvo e CI=true ou confirmação.
  alvo?: Alvo;
  ci?: string | undefined;
  confirmar?: () => string | Promise<string>;
}

// Devolve os nomes das migrations aplicadas nesta execução, na ordem. Antes de conectar, recusa
// host remoto sem alvo explícito e sem CI=true ou confirmação.
export async function migrar({
  urlBanco,
  pasta,
  logger,
  alvo,
  ci,
  confirmar,
}: OpcoesMigrar): Promise<string[]> {
  await exigirHostPermitido({
    url: urlBanco,
    alvo,
    ci,
    ...(confirmar ? { confirmar } : {}),
  });
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

// URL local padrão: o Postgres do docker-compose.
export const URL_LOCAL_PADRAO = 'postgres://postgres:postgres@localhost:5433/evolucao_segura';

// Variável da URL da role de migração em cada branch do Neon.
export const VARIAVEL_DO_ALVO: Record<Alvo, string> = {
  producao: 'NEON_URL_MIGRACAO',
  dev: 'NEON_URL_DEV',
};

export interface Conexao {
  urlBanco: string;
  alvo?: Alvo;
}

function lerAlvo(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i] as string;
    if (argumento === '--alvo') return argv[i + 1] ?? '';
    if (argumento.startsWith('--alvo=')) return argumento.slice('--alvo='.length);
  }
  return undefined;
}

// Decide a URL do `pnpm migrar`. Sem --alvo: DATABASE_URL (ou o Postgres local); a trava do
// migrar() recusa host remoto. Com --alvo producao: NEON_URL_MIGRACAO; com --alvo dev:
// NEON_URL_DEV. A URL é validada como do Neon, e a trava ainda exige CI=true ou o host digitado
// na confirmação.
export function resolverConexao(argv: readonly string[], ambiente: NodeJS.ProcessEnv): Conexao {
  const alvo = lerAlvo(argv);
  if (alvo === undefined) return { urlBanco: ambiente['DATABASE_URL'] ?? URL_LOCAL_PADRAO };
  if (!eAlvo(alvo)) throw new HostRecusado('--alvo precisa ser producao ou dev.');
  const variavel = VARIAVEL_DO_ALVO[alvo];
  const url = ambiente[variavel];
  validarUrlNeon(url, variavel);
  return { urlBanco: url as string, alvo };
}

async function perguntarHost(): Promise<string> {
  if (!process.stdin.isTTY) return '';
  const leitor = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await leitor.question('Banco remoto: digite o host exato para confirmar: ');
  } finally {
    leitor.close();
  }
}

// `pnpm migrar` (local) ou `pnpm migrar --alvo producao|dev` (Neon). DATABASE_URL é só do local.
if (import.meta.main) {
  try {
    const conexao = resolverConexao(process.argv.slice(2), process.env);
    const pasta = resolve(import.meta.dirname, '../migrations');
    const aplicadas = await migrar({
      ...conexao,
      pasta,
      ci: process.env['CI'],
      confirmar: perguntarHost,
    });
    process.stdout.write(`Migrations aplicadas nesta execução: ${aplicadas.length}\n`);
  } catch (erro) {
    if (!(erro instanceof HostRecusado) && !(erro instanceof UrlNeonRecusada)) throw erro;
    process.stderr.write(`${erro.message}\n`);
    process.exitCode = 1;
  }
}
