import { describe, expect, it } from 'vitest';
import { ErroAmbiente, lerAmbiente } from '../src/ambiente.ts';

// OPS-11: variável ausente ou malformada falha na partida.
// (O teste do .env.example lê arquivo e roda em Node: backend/scripts/test/env-example.test.ts.)

// HMAC_2FA_SEGREDO é obrigatória desde a T46 (AUTH-03): sem ela não há código 2FA.
const SEGREDO_HMAC = 'segredo-de-teste-do-hmac-2fa-com-32-ou-mais';
const valido = { URL_PUBLICA: 'https://app.exemplo.com.br', HMAC_2FA_SEGREDO: SEGREDO_HMAC };

describe('lerAmbiente', () => {
  it('aceita o ambiente mínimo (URL_PUBLICA e HMAC_2FA_SEGREDO)', () => {
    const ambiente = lerAmbiente(valido);

    expect(ambiente.URL_PUBLICA).toBe('https://app.exemplo.com.br');
    expect(ambiente.HMAC_2FA_SEGREDO).toBe(SEGREDO_HMAC);
  });

  it('falha quando URL_PUBLICA está ausente, citando só o nome', () => {
    expect(() => lerAmbiente({})).toThrow(ErroAmbiente);
    expect(() => lerAmbiente({})).toThrow('Ambiente inválido: URL_PUBLICA');
  });

  it('falha quando HMAC_2FA_SEGREDO está ausente, citando só o nome', () => {
    let erro: unknown;
    try {
      lerAmbiente({ URL_PUBLICA: valido.URL_PUBLICA });
    } catch (e) {
      erro = e;
    }

    expect(erro).toBeInstanceOf(ErroAmbiente);
    expect((erro as ErroAmbiente).variaveis).toEqual(['HMAC_2FA_SEGREDO']);
    expect((erro as ErroAmbiente).message).toBe('Ambiente inválido: HMAC_2FA_SEGREDO');
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
      HMAC_2FA_SEGREDO: SEGREDO_HMAC,
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
