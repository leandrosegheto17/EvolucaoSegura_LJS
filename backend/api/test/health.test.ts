import { describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.ts';

// OPS-06: GET /api/health responde 200 sem tocar no banco.

// Hyperdrive que lança erro em qualquer uso: se a rota tocar o banco, o teste falha.
const hyperdriveProibido = new Proxy({} as Hyperdrive, {
  get(_alvo, propriedade) {
    throw new Error(`o health não pode usar o Hyperdrive (acessou ${String(propriedade)})`);
  },
});
const env = { HYPERDRIVE: hyperdriveProibido } as Cloudflare.Env;

describe('GET /api/health', () => {
  it('responde 200 com corpo fixo', async () => {
    const resposta = await criarApp().request('/api/health', {}, env);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ status: 'ok' });
  });

  it('não toca o Hyperdrive (que lança erro se usado)', async () => {
    expect(() => env.HYPERDRIVE.connectionString).toThrow('o health não pode usar o Hyperdrive');

    const resposta = await criarApp().request('/api/health', {}, env);

    expect(resposta.status).toBe(200);
  });
});
