import { env } from 'cloudflare:workers';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { comTransacao } from '../src/db.ts';

// Padrão Neon, item 6: os testes da API rodam num banco temporário da execução (es_api_*), criado
// pelo globalSetup, e nunca no banco apontado por DATABASE_URL.

describe('banco dos testes da API', () => {
  it('é o banco temporário desta execução, não o de DATABASE_URL', async () => {
    const banco = await comTransacao(env, null, async (trx) => {
      const { rows } = await sql<{ banco: string }>`select current_database() as banco`.execute(
        trx,
      );
      return rows[0]?.banco;
    });

    expect(banco).toMatch(/^es_api_\d+_\d+$/);
    expect(banco).not.toBe('evolucao_segura');
  });
});
