import type { MiddlewareHandler } from 'hono';

// OPS-09: só 'self' e o Sentry (envio de erros do app). Asaas e outras origens entram só se uma
// tela precisar, com ADR ou nota na tarefa que as usar.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const cabecalhosDeSeguranca: Record<string, string> = {
  'Content-Security-Policy': csp,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// Roda depois do handler para alcançar também as respostas de erro e de rota inexistente.
export const cabecalhos: MiddlewareHandler = async (c, next) => {
  await next();
  for (const [nome, valor] of Object.entries(cabecalhosDeSeguranca)) c.header(nome, valor);
  const { pathname } = new URL(c.req.url);
  if (pathname === '/api' || pathname.startsWith('/api/')) c.header('Cache-Control', 'no-store');
};
