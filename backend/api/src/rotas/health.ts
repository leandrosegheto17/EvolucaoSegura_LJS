import { Hono } from 'hono';

// OPS-06: responde 200 sem tocar no banco (nenhum acesso a env.HYPERDRIVE aqui).
export const health = new Hono<{ Bindings: Cloudflare.Env }>().get('/health', (c) =>
  c.json({ status: 'ok' }),
);
