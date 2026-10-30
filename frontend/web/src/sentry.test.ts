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

// SEC-005 (T216): o nome do paciente aparece no aria-label dos botões (breadcrumb de clique) e na
// busca ?q=<nome> (breadcrumb de fetch e URL da página). Nada disso pode sair para o Sentry.
function eventoComNomeDePaciente(): ErrorEvent {
  return {
    type: undefined,
    message: 'Falha ao buscar /api/pacientes?q=Maria',
    request: {
      url: 'https://app.exemplo.com.br/app/pacientes?q=Maria#topo',
      query_string: 'q=Maria',
      method: 'GET',
    },
    breadcrumbs: [
      {
        category: 'ui.click',
        message: 'main > button.botao[aria-label="Ver pendências de Maria"]',
      },
      {
        category: 'ui.input',
        message: 'input[aria-label="Buscar Maria"]',
      },
      {
        category: 'fetch',
        type: 'http',
        data: { method: 'GET', url: '/api/pacientes?q=Maria', status_code: 200 },
      },
      {
        category: 'xhr',
        type: 'http',
        data: { method: 'GET', url: 'https://app.exemplo.com.br/api/pacientes?q=Maria' },
      },
      {
        category: 'navigation',
        data: { from: '/app/pacientes?q=Maria', to: '/app/financeiro?paciente=Maria' },
      },
      { category: 'console', message: 'carregou a agenda' },
    ],
  };
}

describe('limparEvento sem nome de paciente (SEC-005)', () => {
  it('o evento com clique em aria-label e busca ?q=Maria sai sem "Maria"', () => {
    expect(JSON.stringify(limparEvento(eventoComNomeDePaciente()))).not.toContain('Maria');
  });

  it('descarta os breadcrumbs de clique e de digitação e mantém os demais', () => {
    const categorias = limparEvento(eventoComNomeDePaciente()).breadcrumbs?.map((b) => b.category);

    expect(categorias).toEqual(['fetch', 'xhr', 'navigation', 'console']);
  });

  it('tira só a query string das URLs: o caminho continua lá', () => {
    const limpo = limparEvento(eventoComNomeDePaciente());

    expect(limpo.request?.url).toBe('https://app.exemplo.com.br/app/pacientes');
    expect(limpo.request?.query_string).toBeUndefined();
    expect(limpo.breadcrumbs?.[0]?.data).toEqual({
      method: 'GET',
      url: '/api/pacientes',
      status_code: 200,
    });
    expect(limpo.breadcrumbs?.[1]?.data?.['url']).toBe('https://app.exemplo.com.br/api/pacientes');
    expect(limpo.breadcrumbs?.[2]?.data).toEqual({
      from: '/app/pacientes',
      to: '/app/financeiro',
    });
    expect(limpo.message).toBe('Falha ao buscar /api/pacientes');
  });

  it('a máscara de e-mail continua valendo junto com a limpeza nova', () => {
    const evento = eventoComNomeDePaciente();
    evento.message = 'falha para ana@exemplo.com.br em /api/pacientes?q=Maria';
    const limpo = limparEvento(evento);

    expect(limpo.message).toBe('falha para [e-mail removido] em /api/pacientes');
  });
});

describe('beforeBreadcrumb (SEC-005)', () => {
  const { beforeBreadcrumb } = opcoesSentry({ VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' });

  it('descarta o breadcrumb de clique antes de guardá-lo', () => {
    expect(
      beforeBreadcrumb({
        category: 'ui.click',
        message: 'button[aria-label="Ver pendências de Maria"]',
      }),
    ).toBeNull();
  });

  it('guarda o de fetch sem a query string', () => {
    expect(
      beforeBreadcrumb({
        category: 'fetch',
        data: { method: 'GET', url: '/api/pacientes?q=Maria' },
      }),
    ).toEqual({ category: 'fetch', data: { method: 'GET', url: '/api/pacientes' } });
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
