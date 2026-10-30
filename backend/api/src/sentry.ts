import type { Breadcrumb, ErrorEvent } from '@sentry/cloudflare';

// OPS-08: erros do Worker vão ao Sentry com release = SHA do commit e sem corpo de requisição,
// cookie nem e-mail. A função de scrubbing roda em beforeSend, em todo evento.
// SEC-005 (T216): também sem query string (a busca GET /api/pacientes?q=<nome> leva o nome do
// paciente): sai de request.url, de request.query_string, dos breadcrumbs e dos textos.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// URL absoluta, ou caminho que começa com "/" no início do texto ou depois de espaço, aspas, "(" ou
// "=", seguida de query string (e fragmento): fica só a parte antes do "?".
const URL_COM_QUERY = /(https?:\/\/[^\s?#'"<>]+|(?<=^|[\s'"(=])\/[^\s?#'"<>]*)\?[^\s'"<>]*/g;
const CABECALHOS_SENSIVEIS = new Set(['cookie', 'set-cookie', 'authorization', 'x-csrf-token']);

// Troca qualquer e-mail e tira a query string das URLs dentro de textos do evento (mensagem,
// exceção, breadcrumbs, extras...).
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

export function limparBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return limparTextos(breadcrumb) as Breadcrumb;
}

export function limparEvento(evento: ErrorEvent): ErrorEvent {
  const limpo = limparTextos(evento) as ErrorEvent;
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
    beforeBreadcrumb: limparBreadcrumb,
  };
}
