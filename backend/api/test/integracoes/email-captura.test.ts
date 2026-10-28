import { describe, expect, it } from 'vitest';
import { lerAmbiente } from '../../src/ambiente.ts';
import { emailCobrancaPadrao } from '../../src/integracoes/emails-cobranca.ts';
import { criarClienteCaptura } from '../../src/integracoes/email-captura.ts';

// OPS-05 (T158): nos testes e2e o e-mail não vai ao Resend; o Worker local entrega a mensagem a um
// coletor em localhost. Só funciona com E2E_EMAIL_CAPTURA_URL, que o schema só aceita em localhost.

const mensagem = { para: 'ana@exemplo.com.br', assunto: 'Assunto', texto: 'Corpo do e-mail' };
const base = { URL_PUBLICA: 'https://app.exemplo.com.br', HMAC_2FA_SEGREDO: 'x'.repeat(32) };

describe('criarClienteCaptura', () => {
  it('envia a mensagem como JSON por POST ao coletor', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init ?? {} });
      return new Response('ok');
    }) as typeof fetch;

    await criarClienteCaptura('http://localhost:8799/emails', fetchFn).enviar(mensagem);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe('http://localhost:8799/emails');
    expect(chamadas[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(chamadas[0]!.init.body))).toEqual(mensagem);
  });

  it('falha quando o coletor recusa', async () => {
    const fetchFn = (async () => new Response('x', { status: 500 })) as typeof fetch;

    await expect(
      criarClienteCaptura('http://localhost:8799/emails', fetchFn).enviar(mensagem),
    ).rejects.toThrow();
  });
});

describe('E2E_EMAIL_CAPTURA_URL no ambiente', () => {
  it.each(['http://localhost:8799/emails', 'http://127.0.0.1:8799/emails'])('aceita %s', (url) => {
    expect(lerAmbiente({ ...base, E2E_EMAIL_CAPTURA_URL: url }).E2E_EMAIL_CAPTURA_URL).toBe(url);
  });

  it.each(['https://evil.example.com/emails', 'http://exemplo.com/emails', 'nao-e-url'])(
    'recusa %s (nunca fora de localhost)',
    (url) => {
      expect(() => lerAmbiente({ ...base, E2E_EMAIL_CAPTURA_URL: url })).toThrow(
        'Ambiente inválido: E2E_EMAIL_CAPTURA_URL',
      );
    },
  );
});

describe('e-mail de cobrança com captura', () => {
  it('usa o coletor mesmo sem RESEND_API_KEY', () => {
    const env = { E2E_EMAIL_CAPTURA_URL: 'http://localhost:8799/emails' } as Cloudflare.Env;

    expect(emailCobrancaPadrao(env)).not.toBeNull();
  });
});
