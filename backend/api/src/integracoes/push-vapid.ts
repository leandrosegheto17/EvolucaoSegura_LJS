// PUSH-06, PUSH-07 (AD-004; spike push-worker): JWT VAPID (RFC 8292) assinado pelo próprio
// projeto, ES256 com crypto.subtle. Sem a claim `iat`: o FCM recusa o JWT que a tem, e a
// biblioteca @block65/webcrypto-web-push 2.0.0 sempre a inclui (403 `invalid JWT provided` no
// spike). Da biblioteca usa-se só a cifra (T176); o Authorization vem daqui.
// - Claims: aud = origem do endpoint, exp = agora + 12 h (o RFC limita a 24 h), sub = contato.
// - Chaves no formato do produto: pública P-256 crua (65 bytes) e privada como o `d` do JWK,
//   ambas em base64url.

export const VALIDADE_JWT_VAPID_S = 12 * 60 * 60;

export interface OpcoesJwtVapid {
  endpoint: string;
  // Contato do responsável pelo envio: `mailto:` ou URL https.
  assunto: string;
  chavePublica: string;
  chavePrivada: string;
  agora: Date;
}

const codificador = new TextEncoder();

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const deBase64url = (texto: string): Uint8Array =>
  Uint8Array.from(atob(texto.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

const jsonBase64url = (valor: unknown): string =>
  base64url(codificador.encode(JSON.stringify(valor)));

async function importarChavePrivada(chavePublica: string, chavePrivada: string) {
  const crua = deBase64url(chavePublica);
  if (crua.byteLength !== 65 || crua[0] !== 4)
    throw new Error('push-vapid: chave pública VAPID inválida (P-256 crua, 65 bytes)');
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: base64url(crua.slice(1, 33)),
      y: base64url(crua.slice(33, 65)),
      d: chavePrivada,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

export async function assinarJwtVapid(opcoes: OpcoesJwtVapid): Promise<string> {
  const chave = await importarChavePrivada(opcoes.chavePublica, opcoes.chavePrivada);
  const cabecalho = jsonBase64url({ typ: 'JWT', alg: 'ES256' });
  const carga = jsonBase64url({
    aud: new URL(opcoes.endpoint).origin,
    exp: Math.floor(opcoes.agora.getTime() / 1000) + VALIDADE_JWT_VAPID_S,
    sub: opcoes.assunto,
  });
  const entrada = `${cabecalho}.${carga}`;
  // Web Crypto devolve a assinatura ECDSA crua (r || s), que é o formato do JWS ES256.
  const assinatura = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    chave,
    codificador.encode(entrada),
  );
  return `${entrada}.${base64url(new Uint8Array(assinatura))}`;
}

// Authorization do RFC 8292: `vapid t=<jwt>, k=<chave pública>`.
export async function cabecalhoAutorizacaoVapid(opcoes: OpcoesJwtVapid): Promise<string> {
  return `vapid t=${await assinarJwtVapid(opcoes)}, k=${opcoes.chavePublica}`;
}
