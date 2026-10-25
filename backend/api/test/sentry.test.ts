import { exports } from 'cloudflare:workers';
import type { ErrorEvent } from '@sentry/cloudflare';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.ts';
import { limparEvento, opcoesSentry } from '../src/sentry.ts';

// OPS-08: Sentry com release = SHA e sem corpo, cookie nem e-mail.

function eventoComDadosPessoais(): ErrorEvent {
  return {
    type: undefined,
    message: 'falha ao enviar para ana@exemplo.com.br',
    exception: { values: [{ type: 'Error', value: 'e-mail ana@exemplo.com.br já existe' }] },
    user: { id: 'u1', email: 'ana@exemplo.com.br' },
    request: {
      url: 'https://app.exemplo.com.br/api/cadastro',
      method: 'POST',
      data: { email: 'ana@exemplo.com.br', senha: 'segredo-muito-forte' },
      cookies: { '__Host-sid': 'abc' },
      headers: {
        Cookie: '__Host-sid=abc',
        'X-CSRF-Token': 'token',
        'content-type': 'application/json',
      },
    },
    breadcrumbs: [{ message: 'login de ana@exemplo.com.br' }],
  };
}

describe('limparEvento (scrubbing)', () => {
  it('remove o corpo da requisição', () => {
    expect(limparEvento(eventoComDadosPessoais()).request?.data).toBeUndefined();
  });

  it('remove o cookie (campo cookies e cabeçalhos Cookie e X-CSRF-Token)', () => {
    const { request } = limparEvento(eventoComDadosPessoais());

    expect(request?.cookies).toBeUndefined();
    expect(request?.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('remove o e-mail do usuário e de qualquer texto do evento', () => {
    const limpo = limparEvento(eventoComDadosPessoais());

    expect(limpo.user).toEqual({ id: 'u1' });
    expect(JSON.stringify(limpo)).not.toContain('ana@exemplo.com.br');
    expect(limpo.message).toBe('falha ao enviar para [e-mail removido]');
  });

  it('mantém o que não é sensível (método e URL)', () => {
    const { request } = limparEvento(eventoComDadosPessoais());

    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('https://app.exemplo.com.br/api/cadastro');
  });
});

describe('opcoesSentry', () => {
  it('usa SENTRY_RELEASE como release e SENTRY_DSN como dsn', () => {
    const opcoes = opcoesSentry({
      SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1',
      SENTRY_RELEASE: '24f04e0',
    });

    expect(opcoes.release).toBe('24f04e0');
    expect(opcoes.dsn).toBe('https://k@o1.ingest.sentry.io/1');
    expect(opcoes.beforeSend).toBe(limparEvento);
  });

  it('sem DSN e sem release, nenhum dos dois entra nas opções (Sentry desligado)', () => {
    const opcoes = opcoesSentry({});

    expect('dsn' in opcoes).toBe(false);
    expect('release' in opcoes).toBe(false);
  });
});

describe('erro não tratado', () => {
  it('vira 500 genérico, sem vazar a mensagem, e é capturado', async () => {
    const capturados: unknown[] = [];
    const app = criarApp({ capturarErro: (erro) => capturados.push(erro) });
    const falha = new Error('detalhe interno com ana@exemplo.com.br');
    app.get('/api/falha', () => {
      throw falha;
    });

    const resposta = await app.request('/api/falha', {}, {} as Cloudflare.Env);

    expect(resposta.status).toBe(500);
    expect(resposta.headers.get('Content-Type')).toBe('application/problem+json');
    expect(await resposta.json()).toEqual({
      tipo: 'about:blank',
      titulo: 'Erro interno',
      status: 500,
      codigo: 'erro_interno',
    });
    expect(capturados).toEqual([falha]);
  });
});

describe('Worker com o Sentry', () => {
  it('responde ao health pelo ponto de entrada, mesmo sem DSN', async () => {
    const resposta = await exports.default.fetch('http://localhost/api/health');

    expect(resposta.status).toBe(200);
  });
});
