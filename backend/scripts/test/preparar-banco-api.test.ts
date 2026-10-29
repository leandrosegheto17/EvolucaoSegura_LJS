import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepararBancoEm, semGanchoDePilha } from '../../api/test/preparar-banco.ts';
import { HostRecusado } from '../src/seguranca/trava-host.ts';

// globalSetup dos testes da API. Padrão Neon, item 4: troca a senha da role do app e por isso só
// aceita o Postgres local; a recusa acontece antes de qualquer conexão (URL fictícia, sem senha).
// Item 6: os testes da API rodam num banco temporário, criado e migrado no início e apagado no
// fim, em vez do banco de DATABASE_URL.

const urlServidor =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/evolucao_segura';
const manutencao = new URL(urlServidor);
manutencao.pathname = '/postgres';
const admin = new pg.Client({ connectionString: manutencao.toString() });

async function existe(nome: string): Promise<boolean> {
  const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [nome]);
  return rowCount === 1;
}

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  await admin.end();
});

describe('preparar-banco da API: trava de host', () => {
  it.each([
    ['o Neon', 'postgresql://u@ep-exemplo-123456.sa-east-1.aws.neon.tech/evolucao?sslmode=require'],
    ['outro host remoto', 'postgresql://u@db.exemplo.com:5432/banco'],
  ])('recusa %s', async (_caso, url) => {
    await expect(prepararBancoEm(url, 'es_api_trava')).rejects.toThrow(HostRecusado);
  });
});

describe('preparar-banco da API: banco temporário por execução', () => {
  it('cria um banco novo e migrado, que a função devolvida apaga', async () => {
    const nome = `es_api_t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    const apagar = await prepararBancoEm(urlServidor, nome);
    try {
      expect(await existe(nome)).toBe(true);
      const url = new URL(urlServidor);
      url.pathname = `/${nome}`;
      const cliente = new pg.Client({ connectionString: url.toString() });
      await cliente.connect();
      try {
        const { rows } = await cliente.query<{ total: string }>(
          'select count(*)::text as total from pgmigrations',
        );
        expect(Number(rows[0]?.total)).toBeGreaterThan(0);
      } finally {
        await cliente.end();
      }
    } finally {
      await apagar();
    }

    expect(await existe(nome)).toBe(false);
  }, 120_000);

  it.each(['evolucao_segura', 'es_api_x; drop database postgres', 'ES_API_X', ''])(
    'recusa nome fora do padrão es_api_* (%s) sem criar nada',
    async (nome) => {
      await expect(prepararBancoEm(urlServidor, nome)).rejects.toThrow(/inválido/);
    },
  );
});

// Bug do CI (ci-globalsetup-api): dentro do processo do Vitest, o jiti (que o node-pg-migrate usa
// para carregar as migrations .ts) transpila 0001_base.ts e o Error.prepareStackTrace que o Vite
// instala lança "code.charCodeAt is not a function". O globalSetup morria e o Vitest mostrava "No test
// files found" em todos os projetos. O cache em disco do jiti escondia o defeito na máquina de quem
// já tinha rodado a suíte; o CI sempre começa sem cache. O teste roda um projeto mínimo do Vitest
// com esse globalSetup, num processo à parte e com o cache desligado.
describe('preparar-banco da API: dentro do globalSetup do Vitest', () => {
  it('migra e deixa os testes rodarem, sem cache do jiti', () => {
    const bin = join(
      dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
      'vitest.mjs',
    );
    const raiz = resolve(import.meta.dirname, 'fixtures/globalsetup-api');
    const resultado = spawnSync(process.execPath, [bin, 'run', '--root', raiz], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: urlServidor, JITI_FS_CACHE: 'false', NO_COLOR: '1' },
      timeout: 110_000,
    });
    const saida = `${resultado.stdout}
${resultado.stderr}`;
    expect(saida).not.toMatch(/No test files found|Startup Error|charCodeAt/);
    expect(saida).toMatch(/Tests\s+1 passed/);
    expect(resultado.status).toBe(0);
  }, 120_000);
});

describe('preparar-banco da API: semGanchoDePilha', () => {
  const gancho = (): string => 'gancho';

  it('desliga o gancho durante o trabalho e o devolve ao terminar', async () => {
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = gancho;
    try {
      let durante: unknown = 'não rodou';
      await semGanchoDePilha(async () => {
        durante = Error.prepareStackTrace;
      });
      expect(durante).toBeUndefined();
      expect(Error.prepareStackTrace).toBe(gancho);
    } finally {
      Error.prepareStackTrace = original;
    }
  });

  it('devolve o gancho também quando o trabalho lança', async () => {
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = gancho;
    try {
      await expect(
        semGanchoDePilha(async () => {
          throw new Error('falhou');
        }),
      ).rejects.toThrow('falhou');
      expect(Error.prepareStackTrace).toBe(gancho);
    } finally {
      Error.prepareStackTrace = original;
    }
  });
});
