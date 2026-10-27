import type { ConfigVapid } from '../../src/integracoes/push.ts';

// Apoio dos testes das tarefas de push: chaves VAPID de teste, um "navegador" inscrito (par ECDH
// P-256 e segredo de 16 bytes, como o PushManager entrega) e a decifração do corpo aes128gcm
// (RFC 8291 + RFC 8188, um registro só) do lado de quem recebe.

const codificador = new TextEncoder();

const base64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const juntar = (...partes: Uint8Array[]): Uint8Array => {
  const total = new Uint8Array(partes.reduce((n, p) => n + p.byteLength, 0));
  let i = 0;
  for (const p of partes) {
    total.set(p, i);
    i += p.byteLength;
  }
  return total;
};

async function hmac(chave: Uint8Array, dados: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dados));
}

export async function vapidDeTeste(): Promise<ConfigVapid> {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', par.privateKey)) as JsonWebKey;
  const crua = (await crypto.subtle.exportKey('raw', par.publicKey)) as ArrayBuffer;
  return {
    chavePublica: base64url(crua),
    chavePrivada: jwk.d!,
    assunto: 'mailto:contato@evolucaosegura.com.br',
  };
}

export interface NavegadorDePush {
  par: CryptoKeyPair;
  publica: Uint8Array;
  segredo: Uint8Array;
  p256dh: string;
  auth: string;
}

export async function navegadorDePush(): Promise<NavegadorDePush> {
  const par = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publica = new Uint8Array(
    (await crypto.subtle.exportKey('raw', par.publicKey)) as ArrayBuffer,
  );
  const segredo = crypto.getRandomValues(new Uint8Array(16));
  return { par, publica, segredo, p256dh: base64url(publica), auth: base64url(segredo) };
}

export async function decifrarPush(nav: NavegadorDePush, corpo: Uint8Array): Promise<string> {
  const sal = corpo.slice(0, 16);
  const tamanhoChave = corpo[20]!;
  const publicaServidor = corpo.slice(21, 21 + tamanhoChave);
  const cifrado = corpo.slice(21 + tamanhoChave);
  const chaveServidor = await crypto.subtle.importKey(
    'raw',
    publicaServidor,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const compartilhado = new Uint8Array(
    await crypto.subtle.deriveBits(
      // Os tipos do workerd chamam o campo de `$public`; o runtime aceita `public` (Web Crypto).
      { name: 'ECDH', public: chaveServidor } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      nav.par.privateKey,
      256,
    ),
  );
  const prkChave = await hmac(nav.segredo, compartilhado);
  const ikm = (
    await hmac(
      prkChave,
      juntar(
        codificador.encode('WebPush: info\0'),
        nav.publica,
        publicaServidor,
        new Uint8Array([1]),
      ),
    )
  ).slice(0, 32);
  const prk = await hmac(sal, ikm);
  const cek = (
    await hmac(
      prk,
      juntar(codificador.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])),
    )
  ).slice(0, 16);
  const nonce = (
    await hmac(prk, juntar(codificador.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))
  ).slice(0, 12);
  const chaveAes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const aberto = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, chaveAes, cifrado),
  );
  let fim = aberto.length - 1;
  while (aberto[fim] === 0) fim -= 1;
  if (aberto[fim] !== 2) throw new Error('decifrarPush: sem o delimitador do último registro');
  return new TextDecoder().decode(aberto.slice(0, fim));
}
