import * as Sentry from '@sentry/cloudflare';
import { Hono } from 'hono';
import { cabecalhos } from './middleware/cabecalhos.ts';
import { limitePorIp } from './middleware/limite.ts';
import { type ClienteEmail, criarClienteResend } from './integracoes/resend.ts';
import { rotasReenviar2fa } from './rotas/auth-2fa-reenviar.ts';
import { rotas2fa } from './rotas/auth-2fa.ts';
import { rotasEntrar } from './rotas/auth-entrar.ts';
import { rotasSair } from './rotas/auth-sair.ts';
import { rotasCadastro } from './rotas/cadastro.ts';
import { rotasConfirmar } from './rotas/confirmar.ts';
import { health } from './rotas/health.ts';

interface OpcoesApp {
  capturarErro?: (erro: unknown) => void;
  // Os testes trocam o Resend por um cliente simulado.
  email?: (env: Cloudflare.Env) => ClienteEmail;
}

// Chave ou remetente ausente faz a criação lançar: quem envia trata como falha de envio.
const emailPadrao = (env: Cloudflare.Env): ClienteEmail =>
  criarClienteResend({ apiKey: env.RESEND_API_KEY ?? '', remetente: env.MAIL_FROM ?? '' });

export function criarApp(opcoes: OpcoesApp = {}): Hono<{ Bindings: Cloudflare.Env }> {
  const capturarErro = opcoes.capturarErro ?? ((erro) => Sentry.captureException(erro));
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.use('*', cabecalhos);
  app.use('/api/*', limitePorIp);
  app.route('/api', health);
  app.route('/api', rotasCadastro({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route('/api', rotasConfirmar);
  app.route('/api', rotasEntrar({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route('/api', rotas2fa);
  app.route('/api', rotasReenviar2fa({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route('/api', rotasSair);
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
