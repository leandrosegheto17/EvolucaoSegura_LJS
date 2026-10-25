import type { ErrorEvent } from '@sentry/react';
import { describe, expect, it } from 'vitest';
import { limparEvento, opcoesSentry } from './sentry.ts';

// OPS-08: Sentry do app com release = SHA e sem corpo, cookie nem e-mail.

function eventoComDadosPessoais(): ErrorEvent {
  return {
    type: undefined,
    message: 'falha ao salvar o perfil de ana@exemplo.com.br',
    user: { id: 'u1', email: 'ana@exemplo.com.br' },
    request: {
      url: 'https://app.exemplo.com.br/app/perfil',
      method: 'PUT',
      data: { email: 'ana@exemplo.com.br' },
      cookies: { '__Host-sid': 'abc' },
      headers: { Cookie: '__Host-sid=abc', 'content-type': 'application/json' },
    },
    breadcrumbs: [{ message: 'clicou em ana@exemplo.com.br' }],
  };
}

describe('limparEvento (scrubbing do front)', () => {
  it('remove o corpo da requisição', () => {
    expect(limparEvento(eventoComDadosPessoais()).request?.data).toBeUndefined();
  });

  it('remove o cookie', () => {
    const { request } = limparEvento(eventoComDadosPessoais());

    expect(request?.cookies).toBeUndefined();
    expect(request?.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('remove o e-mail do usuário e de qualquer texto do evento', () => {
    const limpo = limparEvento(eventoComDadosPessoais());

    expect(limpo.user).toEqual({ id: 'u1' });
    expect(JSON.stringify(limpo)).not.toContain('ana@exemplo.com.br');
  });
});

describe('opcoesSentry (front)', () => {
  it('usa o SHA como release e liga o scrubbing', () => {
    const opcoes = opcoesSentry({
      VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1',
      VITE_SENTRY_RELEASE: '24f04e0',
    });

    expect(opcoes.release).toBe('24f04e0');
    expect(opcoes.dsn).toBe('https://k@o1.ingest.sentry.io/1');
    expect(opcoes.beforeSend).toBe(limparEvento);
    expect(opcoes.sendDefaultPii).toBe(false);
  });

  it('sem DSN não define dsn (Sentry desligado)', () => {
    expect('dsn' in opcoesSentry({})).toBe(false);
  });
});
