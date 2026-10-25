import * as Sentry from '@sentry/cloudflare';
import { Hono } from 'hono';
import { cabecalhos } from './middleware/cabecalhos.ts';
import { health } from './rotas/health.ts';

interface OpcoesApp {
  capturarErro?: (erro: unknown) => void;
}

export function criarApp(opcoes: OpcoesApp = {}): Hono<{ Bindings: Cloudflare.Env }> {
  const capturarErro = opcoes.capturarErro ?? ((erro) => Sentry.captureException(erro));
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.use('*', cabecalhos);
  app.route('/api', health);
  // Erro não tratado: vai ao Sentry e o usuário recebe um 500 genérico, sem detalhe do erro.
  app.onError((erro, c) => {
    capturarErro(erro);
    return c.json(
      { tipo: 'about:blank', titulo: 'Erro interno', status: 500, codigo: 'erro_interno' },
      500,
      { 'Content-Type': 'application/problem+json' },
    );
  });
  return app;
}
