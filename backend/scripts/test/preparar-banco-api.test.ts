import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepararBancoEm } from '../../api/test/preparar-banco.ts';
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
