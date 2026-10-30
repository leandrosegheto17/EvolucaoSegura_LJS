import * as Sentry from '@sentry/react';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';

// OPS-08: erros do app vão ao Sentry com release = SHA do commit e sem corpo de requisição,
// cookie nem e-mail. Mesma regra do Worker (backend/api/src/sentry.ts); o front não importa do
// backend, então a função de scrubbing é repetida aqui e testada nos dois lados.
// SEC-005 (T216): também sem nome de paciente. Ele aparece no aria-label dos botões (o Sentry o
// grava nos breadcrumbs de clique e de digitação, que são descartados) e na busca ?q=<nome> (a
// query string sai de toda URL do evento: request.url, breadcrumbs e textos).

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// URL absoluta, ou caminho que começa com "/" no início do texto ou depois de espaço, aspas, "(" ou
// "=", seguida de query string (e fragmento): fica só a parte antes do "?".
const URL_COM_QUERY = /(https?:\/\/[^\s?#'"<>]+|(?<=^|[\s'"(=])\/[^\s?#'"<>]*)\?[^\s'"<>]*/g;
const CABECALHOS_SENSIVEIS = new Set(['cookie', 'set-cookie', 'authorization', 'x-csrf-token']);
const BREADCRUMBS_DO_DOM = new Set(['ui.click', 'ui.input']);

function limparTextos(valor: unknown): unknown {
  if (typeof valor === 'string') {
    return valor.replace(EMAIL, '[e-mail removido]').replace(URL_COM_QUERY, '$1');
  }
  if (Array.isArray(valor)) return valor.map(limparTextos);
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([chave, item]) => [chave, limparTextos(item)]),
    );
  }
  return valor;
}

export function limparBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category !== undefined && BREADCRUMBS_DO_DOM.has(breadcrumb.category)) return null;
  return limparTextos(breadcrumb) as Breadcrumb;
}

export function limparEvento(evento: ErrorEvent): ErrorEvent {
  const limpo = limparTextos(evento) as ErrorEvent;
  if (limpo.breadcrumbs) {
    limpo.breadcrumbs = limpo.breadcrumbs.filter((b) => limparBreadcrumb(b) !== null);
  }
  if (limpo.request) {
    delete limpo.request.data;
    delete limpo.request.cookies;
    delete limpo.request.query_string;
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
    beforeBreadcrumb: limparBreadcrumb,
  };
}

export function iniciarSentry(env: VariaveisSentry): void {
  const opcoes = opcoesSentry(env);
  if (opcoes.dsn === undefined) return;
  Sentry.init(opcoes);
}
