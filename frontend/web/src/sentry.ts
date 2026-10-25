import * as Sentry from '@sentry/react';
import type { ErrorEvent } from '@sentry/react';

// OPS-08: erros do app vão ao Sentry com release = SHA do commit e sem corpo de requisição,
// cookie nem e-mail. Mesma regra do Worker (backend/api/src/sentry.ts); o front não importa do
// backend, então a função de scrubbing é repetida aqui e testada nos dois lados.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CABECALHOS_SENSIVEIS = new Set(['cookie', 'set-cookie', 'authorization', 'x-csrf-token']);

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
  VITE_SENTRY_DSN?: string | undefined;
  VITE_SENTRY_RELEASE?: string | undefined;
}

// DSN e release entram no build (VITE_SENTRY_DSN e VITE_SENTRY_RELEASE = SHA do commit, que o
// deploy.yml define). Sem DSN, o Sentry fica desligado.
export function opcoesSentry(env: VariaveisSentry) {
  return {
    ...(env.VITE_SENTRY_DSN ? { dsn: env.VITE_SENTRY_DSN } : {}),
    ...(env.VITE_SENTRY_RELEASE ? { release: env.VITE_SENTRY_RELEASE } : {}),
    sendDefaultPii: false,
    beforeSend: limparEvento,
  };
}

export function iniciarSentry(env: VariaveisSentry): void {
  const opcoes = opcoesSentry(env);
  if (opcoes.dsn === undefined) return;
  Sentry.init(opcoes);
}
