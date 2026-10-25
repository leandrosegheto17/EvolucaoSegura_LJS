import { env } from 'cloudflare:workers';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

// OPS-05 / T16: o harness roda os testes dentro do runtime do Worker e alcança o Postgres local.

describe('harness do Worker', () => {
  it('roda dentro do runtime do Worker (workerd)', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers');
  });

  it('conecta ao Postgres local pelo binding do Hyperdrive', async () => {
    const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
    // O pg-cloudflare emite 'error' ao ler do socket que acabou de fechar; sem ouvinte o Vitest
    // trata como rejeição não tratada. Ignorar aqui não esconde falha de consulta (ela rejeita o await).
    client.on('error', () => {});
    await client.connect();
    try {
      const resultado = await client.query<{ banco: string; um: number }>(
        'select current_database() as banco, 1 as um',
      );
      expect(resultado.rows[0]).toEqual({ banco: 'evolucao_segura', um: 1 });
    } finally {
      await client.end();
    }
  });
});
