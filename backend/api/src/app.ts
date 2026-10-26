import * as Sentry from '@sentry/cloudflare';
import { waitUntil } from 'cloudflare:workers';
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
import { rotasEu } from './rotas/eu.ts';
import { health } from './rotas/health.ts';
import { rotasRecuperar } from './rotas/recuperar.ts';

interface OpcoesApp {
  capturarErro?: (erro: unknown) => void;
  // Os testes trocam o Resend por um cliente simulado.
  email?: (env: Cloudflare.Env) => ClienteEmail;
  // Trabalho depois da resposta (padrão: waitUntil do Worker); os testes guardam e esperam.
  emSegundoPlano?: (tarefa: Promise<unknown>) => void;
}

// Chave ou remetente ausente faz a criação lançar: quem envia trata como falha de envio.
const emailPadrao = (env: Cloudflare.Env): ClienteEmail =>
  criarClienteResend({ apiKey: env.RESEND_API_KEY ?? '', remetente: env.MAIL_FROM ?? '' });

export function criarApp(opcoes: OpcoesApp = {}): Hono<{ Bindings: Cloudflare.Env }> {
  const capturarErro = opcoes.capturarErro ?? ((erro) => Sentry.captureException(erro));
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  // Pipeline (design): cabeçalhos e rate limit valem para tudo; sessão, CSRF e transação, só nas
  // rotas autenticadas (middleware/autenticada.ts). Rotas públicas pulam sessão e CSRF.
  app.use('*', cabecalhos);
  app.use('/api/*', limitePorIp);
  app.route('/api', health);
  app.route('/api', rotasCadastro({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route('/api', rotasConfirmar);
  app.route('/api', rotasEntrar({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route('/api', rotas2fa);
  app.route('/api', rotasReenviar2fa({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route(
    '/api',
    rotasRecuperar({
      email: opcoes.email ?? emailPadrao,
      capturarErro,
      emSegundoPlano: opcoes.emSegundoPlano ?? waitUntil,
    }),
  );
  // Autenticadas: cada rota monta a lista `autenticada` (sessão, CSRF, transação).
  app.route('/api', rotasSair);
  app.route('/api', rotasEu);
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
