import { Hono } from 'hono';
import { cabecalhos } from './middleware/cabecalhos.ts';
import { health } from './rotas/health.ts';

export function criarApp(): Hono<{ Bindings: Cloudflare.Env }> {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.use('*', cabecalhos);
  app.route('/api', health);
  return app;
}
