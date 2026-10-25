import { describe, expect, it } from 'vitest';
import { ErroAmbiente, lerAmbiente } from '../src/ambiente.ts';

// OPS-11: variável ausente ou malformada falha na partida.
// (O teste do .env.example lê arquivo e roda em Node: backend/scripts/test/env-example.test.ts.)

const valido = { URL_PUBLICA: 'https://app.exemplo.com.br' };

describe('lerAmbiente', () => {
  it('aceita o ambiente mínimo (só URL_PUBLICA)', () => {
    expect(lerAmbiente(valido).URL_PUBLICA).toBe('https://app.exemplo.com.br');
  });

  it('falha quando URL_PUBLICA está ausente, citando só o nome', () => {
    expect(() => lerAmbiente({})).toThrow(ErroAmbiente);
    expect(() => lerAmbiente({})).toThrow('Ambiente inválido: URL_PUBLICA');
  });

  it.each([
    ['URL_PUBLICA', 'nao-e-url'],
    ['URL_PUBLICA', 'http://app.exemplo.com.br'],
    ['URL_PUBLICA', 'https://app.exemplo.com.br/'],
    ['MAIL_FROM', 'alguem@outro-dominio.com'],
    ['RESEND_API_KEY', 'sem-prefixo'],
    ['HMAC_2FA_SEGREDO', 'curto'],
    ['ASAAS_WEBHOOK_TOKEN', 'curto'],
    ['ASAAS_BASE_URL', 'https://outro.asaas.com/v3'],
    ['VAPID_SUBJECT', 'contato@evolucaosegura.com.br'],
    ['SENTRY_DSN', 'http://chave@sentry.io/1'],
    ['SENTRY_RELEASE', 'nao-e-sha'],
  ])('falha quando %s está malformada (%s)', (variavel, valor) => {
    let erro: unknown;
    try {
      lerAmbiente({ ...valido, [variavel]: valor });
    } catch (e) {
      erro = e;
    }

    expect(erro).toBeInstanceOf(ErroAmbiente);
    expect((erro as ErroAmbiente).variaveis).toContain(variavel);
    expect((erro as ErroAmbiente).message).not.toContain(valor);
  });

  it('aceita http apenas em localhost e as opcionais bem formadas', () => {
    const ambiente = lerAmbiente({
      URL_PUBLICA: 'http://localhost:8787',
      MAIL_FROM: 'Evolução Segura <nao-responda@evolucaosegura.com.br>',
      RESEND_API_KEY: 're_abc123',
      ASAAS_BASE_URL: 'https://api.asaas.com/v3',
      VAPID_SUBJECT: 'mailto:contato@evolucaosegura.com.br',
      SENTRY_RELEASE: '24f04e0',
    });

    expect(ambiente.URL_PUBLICA).toBe('http://localhost:8787');
    expect(ambiente.SENTRY_RELEASE).toBe('24f04e0');
  });
});
