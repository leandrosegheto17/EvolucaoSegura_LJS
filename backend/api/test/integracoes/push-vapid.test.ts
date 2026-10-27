import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VALIDADE_JWT_VAPID_S,
  assinarJwtVapid,
  cabecalhoAutorizacaoVapid,
} from '../../src/integracoes/push-vapid.ts';

// T142 / PUSH-06, PUSH-07 (AD-004, spike push-worker): o JWT VAPID é assinado pelo próprio
// projeto, ES256 com crypto.subtle, SEM a claim iat (o FCM recusa JWT com iat, como o da
// biblioteca 2.0.0). Claims do spike: aud = origem do endpoint, exp = agora + 12 h, sub = contato
// (mailto:). Cabeçalho Authorization: `vapid t=<jwt>, k=<chave pública>` (RFC 8292). Roda no
// workerd (Web Crypto do Worker).

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123:APA91b-x';
const ASSUNTO = 'mailto:contato@evolucaosegura.com.br';
const AGORA = new Date('2026-11-10T17:00:00.123Z');

const base64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const deBase64url = (texto: string): Uint8Array =>
  Uint8Array.from(atob(texto.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

const decodificar = (parte: string): unknown =>
  JSON.parse(new TextDecoder().decode(deBase64url(parte)));

// Par de chaves VAPID de teste no formato do produto: pública P-256 crua (65 bytes) e privada como
// o `d` do JWK, ambas em base64url (spike: formato de `vapid` da biblioteca).
async function chavesDeTeste() {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', par.privateKey)) as JsonWebKey;
  const crua = (await crypto.subtle.exportKey('raw', par.publicKey)) as ArrayBuffer;
  return { publica: base64url(crua), privada: jwk.d!, chavePublica: par.publicKey };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JWT VAPID sem iat (AD-004, spike push-worker)', () => {
  it('as claims são exatamente aud, exp e sub: sem iat', async () => {
    const chaves = await chavesDeTeste();
    const jwt = await assinarJwtVapid({
      endpoint: ENDPOINT,
      assunto: ASSUNTO,
      chavePublica: chaves.publica,
      chavePrivada: chaves.privada,
      agora: AGORA,
    });
    const [, carga] = jwt.split('.');
    const claims = decodificar(carga!) as Record<string, unknown>;
    expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'sub']);
    expect(claims).not.toHaveProperty('iat');
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(AGORA.getTime() / 1000) + 12 * 60 * 60,
      sub: ASSUNTO,
    });
  });

  it('exp é agora + 12 h, dentro do limite de 24 h do RFC 8292', () => {
    expect(VALIDADE_JWT_VAPID_S).toBe(12 * 60 * 60);
    expect(VALIDADE_JWT_VAPID_S).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('aud é a origem do endpoint de cada serviço de push', async () => {
    const chaves = await chavesDeTeste();
    for (const [endpoint, origem] of [
      [
        'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
        'https://updates.push.services.mozilla.com',
      ],
      ['https://web.push.apple.com/QGuQ', 'https://web.push.apple.com'],
      [
        'https://wns2-par02p.notify.windows.com:443/w/?token=x',
        'https://wns2-par02p.notify.windows.com',
      ],
    ] as const) {
      const jwt = await assinarJwtVapid({
        endpoint,
        assunto: ASSUNTO,
        chavePublica: chaves.publica,
        chavePrivada: chaves.privada,
        agora: AGORA,
      });
      expect((decodificar(jwt.split('.')[1]!) as { aud: string }).aud, endpoint).toBe(origem);
    }
  });

  it('o cabeçalho do JWT é ES256', async () => {
    const chaves = await chavesDeTeste();
    const jwt = await assinarJwtVapid({
      endpoint: ENDPOINT,
      assunto: ASSUNTO,
      chavePublica: chaves.publica,
      chavePrivada: chaves.privada,
      agora: AGORA,
    });
    expect(decodificar(jwt.split('.')[0]!)).toEqual({ typ: 'JWT', alg: 'ES256' });
  });
});

describe('assinado com crypto.subtle (PUSH-07)', () => {
  it('a assinatura ES256 confere com a chave pública VAPID', async () => {
    const chaves = await chavesDeTeste();
    const jwt = await assinarJwtVapid({
      endpoint: ENDPOINT,
      assunto: ASSUNTO,
      chavePublica: chaves.publica,
      chavePrivada: chaves.privada,
      agora: AGORA,
    });
    const [cabecalho, carga, assinatura] = jwt.split('.') as [string, string, string];
    const assinaturaCrua = deBase64url(assinatura);
    // JWS ES256: r || s crus, 64 bytes (não DER).
    expect(assinaturaCrua.byteLength).toBe(64);
    const valida = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      chaves.chavePublica,
      assinaturaCrua,
      new TextEncoder().encode(`${cabecalho}.${carga}`),
    );
    expect(valida).toBe(true);
  });

  it('assina por crypto.subtle.sign com ECDSA e SHA-256', async () => {
    const chaves = await chavesDeTeste();
    const sign = vi.spyOn(crypto.subtle, 'sign');
    await assinarJwtVapid({
      endpoint: ENDPOINT,
      assunto: ASSUNTO,
      chavePublica: chaves.publica,
      chavePrivada: chaves.privada,
      agora: AGORA,
    });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign.mock.calls[0]![0]).toEqual({ name: 'ECDSA', hash: 'SHA-256' });
  });

  it('a assinatura de outra chave não confere', async () => {
    const chaves = await chavesDeTeste();
    const outra = await chavesDeTeste();
    const jwt = await assinarJwtVapid({
      endpoint: ENDPOINT,
      assunto: ASSUNTO,
      chavePublica: chaves.publica,
      chavePrivada: chaves.privada,
      agora: AGORA,
    });
    const [cabecalho, carga, assinatura] = jwt.split('.') as [string, string, string];
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        outra.chavePublica,
        deBase64url(assinatura),
        new TextEncoder().encode(`${cabecalho}.${carga}`),
      ),
    ).toBe(false);
  });
});

describe('cabeçalho Authorization (RFC 8292)', () => {
  it('é `vapid t=<jwt>, k=<chave pública>` e o JWT dele não tem iat', async () => {
    const chaves = await chavesDeTeste();
    const autorizacao = await cabecalhoAutorizacaoVapid({
      endpoint: ENDPOINT,
      assunto: ASSUNTO,
      chavePublica: chaves.publica,
      chavePrivada: chaves.privada,
      agora: AGORA,
    });
    const casamento = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(autorizacao);
    expect(casamento).not.toBeNull();
    expect(casamento![2]).toBe(chaves.publica);
    const claims = decodificar(casamento![1]!.split('.')[1]!);
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(AGORA.getTime() / 1000) + 12 * 60 * 60,
      sub: ASSUNTO,
    });
  });
});
