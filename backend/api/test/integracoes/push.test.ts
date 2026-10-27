import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  type AssinaturaPush,
  type MensagemPush,
  enviarPush,
  removerAssinaturaMorta,
} from '../../src/integracoes/push.ts';
import { comoAdmin, emailUnico } from '../apoio.ts';

// T176 / PUSH-06, PUSH-07 (AD-004, spike push-worker): envio do push cifrado.
// - Só a cifra da biblioteca (@block65/webcrypto-web-push, RFC 8291, aes128gcm) é usada; o
//   Authorization é o JWT VAPID da T142, sem iat. Aqui o teste faz o papel do navegador: decifra
//   o corpo com as chaves da inscrição e confere a mensagem.
// - PUSH-06: 404 ou 410 do serviço removem a push_subscription; qualquer outra resposta (201,
//   429, 500) ou erro de rede não remove (201 não prova entrega, spike).
// O serviço de push é simulado por fetch; nenhum teste chama um serviço real.

const AGORA = new Date('2026-11-10T17:00:00.000Z');
const ASSUNTO = 'mailto:contato@evolucaosegura.com.br';
const MENSAGEM: MensagemPush = {
  titulo: 'Sessão próxima',
  corpo: 'Você tem uma sessão às 14:00.',
  url: '/app/agenda',
};

const codificador = new TextEncoder();

const base64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const deBase64url = (texto: string): Uint8Array =>
  Uint8Array.from(atob(texto.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

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

// Chaves VAPID do servidor (pública crua e `d` do JWK, base64url).
async function chavesVapid() {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', par.privateKey)) as JsonWebKey;
  const crua = (await crypto.subtle.exportKey('raw', par.publicKey)) as ArrayBuffer;
  return { chavePublica: base64url(crua), chavePrivada: jwk.d!, assunto: ASSUNTO };
}

// Inscrição de um "navegador": par ECDH P-256 e segredo de 16 bytes, como o PushManager entrega.
async function navegador() {
  const par = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publica = new Uint8Array(
    (await crypto.subtle.exportKey('raw', par.publicKey)) as ArrayBuffer,
  );
  const segredo = crypto.getRandomValues(new Uint8Array(16));
  return { par, publica, segredo, p256dh: base64url(publica), auth: base64url(segredo) };
}

// RFC 8291 + RFC 8188 do lado de quem recebe: decifra o corpo aes128gcm de um registro só.
async function decifrar(nav: Awaited<ReturnType<typeof navegador>>, corpo: Uint8Array) {
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
  const infoChave = juntar(
    codificador.encode('WebPush: info\0'),
    nav.publica,
    publicaServidor,
    new Uint8Array([1]),
  );
  const ikm = (await hmac(prkChave, infoChave)).slice(0, 32);
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
  expect(aberto[fim]).toBe(2); // delimitador do último registro
  return new TextDecoder().decode(aberto.slice(0, fim));
}

interface Chamada {
  url: string;
  init: RequestInit;
}

function servicoDePush(resposta: () => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const fn = async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return resposta();
  };
  return { fn: fn as typeof fetch, chamadas };
}

const cabecalho = (c: Chamada, nome: string) => new Headers(c.init.headers).get(nome);

async function usuario(): Promise<string> {
  const [u] = await comoAdmin<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em) values ($1, 'Ana Souza', now()) returning id`,
    [emailUnico('push')],
  );
  return u!.id;
}

async function inscrever(
  usuarioId: string,
  nav: Awaited<ReturnType<typeof navegador>>,
): Promise<AssinaturaPush> {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
  const [linha] = await comoAdmin<{ id: string }>(
    `insert into push_subscription (usuario_id, endpoint, p256dh, auth)
     values ($1, $2, $3, $4) returning id`,
    [usuarioId, endpoint, nav.p256dh, nav.auth],
  );
  return { id: linha!.id, usuarioId, endpoint, p256dh: nav.p256dh, auth: nav.auth };
}

const existe = async (id: string) =>
  (await comoAdmin(`select 1 from push_subscription where id = $1`, [id])).length === 1;

async function cenario(resposta: () => Response | Promise<Response>) {
  const vapid = await chavesVapid();
  const nav = await navegador();
  const assinatura = await inscrever(await usuario(), nav);
  const servico = servicoDePush(resposta);
  const enviar = () =>
    enviarPush(assinatura, MENSAGEM, {
      vapid,
      agora: AGORA,
      fetch: servico.fn,
      removerAssinatura: removerAssinaturaMorta(env),
    });
  return { vapid, nav, assinatura, servico, enviar };
}

describe('envio cifrado com a cifra da biblioteca e o JWT da T142', () => {
  it('faz POST no endpoint da inscrição com o corpo aes128gcm', async () => {
    const { assinatura, servico, enviar } = await cenario(
      () => new Response(null, { status: 201 }),
    );
    expect(await enviar()).toBe('enviado');
    expect(servico.chamadas).toHaveLength(1);
    const [chamada] = servico.chamadas;
    expect(chamada!.url).toBe(assinatura.endpoint);
    expect(chamada!.init.method?.toUpperCase()).toBe('POST');
    expect(cabecalho(chamada!, 'content-encoding')).toBe('aes128gcm');
    expect(cabecalho(chamada!, 'content-type')).toBe('application/octet-stream');
    expect(Number(cabecalho(chamada!, 'ttl'))).toBeGreaterThan(0);
  });

  it('o navegador da inscrição decifra a mensagem (título, corpo e tela)', async () => {
    const { nav, servico, enviar } = await cenario(() => new Response(null, { status: 201 }));
    await enviar();
    const corpo = new Uint8Array(servico.chamadas[0]!.init.body as ArrayBuffer);
    expect(new TextDecoder().decode(corpo)).not.toContain('Sessão próxima');
    expect(JSON.parse(await decifrar(nav, corpo))).toEqual(MENSAGEM);
  });

  it('o Authorization é o JWT VAPID próprio, sem iat, com a chave pública', async () => {
    const { vapid, servico, enviar } = await cenario(() => new Response(null, { status: 201 }));
    await enviar();
    const autorizacao = cabecalho(servico.chamadas[0]!, 'authorization')!;
    const casamento = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(autorizacao);
    expect(casamento).not.toBeNull();
    expect(casamento![4]).toBe(vapid.chavePublica);
    const claims = JSON.parse(new TextDecoder().decode(deBase64url(casamento![2]!)));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(AGORA.getTime() / 1000) + 12 * 60 * 60,
      sub: ASSUNTO,
    });
  });
});

describe('assinatura morta (PUSH-06)', () => {
  it.each([404, 410])('%i remove a assinatura', async (status) => {
    const { assinatura, enviar } = await cenario(() => new Response(null, { status }));
    expect(await existe(assinatura.id)).toBe(true);
    expect(await enviar()).toBe('assinatura_removida');
    expect(await existe(assinatura.id)).toBe(false);
  });

  it.each([201, 400, 403, 413, 429, 500, 503])('%i não remove', async (status) => {
    const { assinatura, enviar } = await cenario(() => new Response(null, { status }));
    expect(await enviar()).toBe(status === 201 ? 'enviado' : 'falha');
    expect(await existe(assinatura.id)).toBe(true);
  });

  it('erro de rede não remove', async () => {
    const { assinatura, enviar } = await cenario(() => {
      throw new TypeError('fetch failed');
    });
    expect(await enviar()).toBe('falha');
    expect(await existe(assinatura.id)).toBe(true);
  });

  it('remove só a assinatura morta: as outras do profissional e as de outro ficam', async () => {
    const { assinatura, enviar } = await cenario(() => new Response(null, { status: 410 }));
    const outraDoMesmo = await inscrever(assinatura.usuarioId, await navegador());
    const deOutro = await inscrever(await usuario(), await navegador());
    await enviar();
    expect(await existe(assinatura.id)).toBe(false);
    expect(await existe(outraDoMesmo.id)).toBe(true);
    expect(await existe(deOutro.id)).toBe(true);
  });
});
