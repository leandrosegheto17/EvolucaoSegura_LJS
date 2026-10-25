import type { ErrorEvent } from '@sentry/cloudflare';

// OPS-08: erros do Worker vão ao Sentry com release = SHA do commit e sem corpo de requisição,
// cookie nem e-mail. A função de scrubbing roda em beforeSend, em todo evento.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CABECALHOS_SENSIVEIS = new Set(['cookie', 'set-cookie', 'authorization', 'x-csrf-token']);

// Troca qualquer e-mail dentro de textos do evento (mensagem, exceção, breadcrumbs, extras...).
function mascararEmails(valor: unknown): unknown {
  if (typeof valor === 'string') return valor.replace(EMAIL, '[e-mail removido]');
  if (Array.isArray(valor)) return valor.map(mascararEmails);
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([chave, item]) => [chave, mascararEmails(item)]),
    );
  }
  return valor;
}

export function limparEvento(evento: ErrorEvent): ErrorEvent {
  const limpo = mascararEmails(evento) as ErrorEvent;
  if (limpo.request) {
    delete limpo.request.data;
    delete limpo.request.cookies;
    if (limpo.request.headers) {
      for (const nome of Object.keys(limpo.request.headers)) {
        if (CABECALHOS_SENSIVEIS.has(nome.toLowerCase())) delete limpo.request.headers[nome];
      }
    }
  }
  if (limpo.user) delete limpo.user.email;
  return limpo;
}

interface VariaveisSentry {
  SENTRY_DSN?: string | undefined;
  SENTRY_RELEASE?: string | undefined;
}

// O release vem da variável SENTRY_RELEASE (o deploy grava o SHA do commit). Sem DSN, o Sentry
// fica desligado.
export function opcoesSentry(env: VariaveisSentry) {
  return {
    ...(env.SENTRY_DSN ? { dsn: env.SENTRY_DSN } : {}),
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    beforeSend: limparEvento,
  };
}
