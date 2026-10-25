import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

// AUTH-04, AUTH-16: cookie da sessão. O prefixo __Host- obriga Path=/, Secure e nenhum Domain.
// Sem Max-Age: o navegador apaga ao fechar, e o servidor encerra a sessão pelos próprios prazos
// (15 min sem uso ou 12 h do login, AUTH-09).

const OPCOES = { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' } as const;
const NOME = 'sid';

export function definirCookieSessao(c: Context, sid: string): void {
  setCookie(c, NOME, sid, { ...OPCOES, prefix: 'host' });
}

export function lerCookieSessao(c: Context): string | undefined {
  return getCookie(c, NOME, 'host');
}

// AUTH-16: limpa com Max-Age=0.
export function limparCookieSessao(c: Context): void {
  deleteCookie(c, NOME, { ...OPCOES, prefix: 'host' });
}
