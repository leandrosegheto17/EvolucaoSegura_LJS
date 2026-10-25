// AUTH-03: código 2FA de 6 dígitos tirado do CSPRNG do runtime, sem viés (amostragem por
// rejeição). No banco vai só o HMAC-SHA256 de "<usuario_id>:<código>", com a chave
// HMAC_2FA_SEGREDO: sem a chave, o hash guardado não revela o código (são só 10^6 valores).

const FAIXA = 1_000_000;
// Maior múltiplo de 10^6 que cabe em 32 bits: valores acima dele dariam viés e são descartados.
const TETO = Math.floor(2 ** 32 / FAIXA) * FAIXA;

export function gerarCodigo2fa(): string {
  for (;;) {
    const [valor] = crypto.getRandomValues(new Uint32Array(1));
    if (valor! < TETO) return String(valor! % FAIXA).padStart(6, '0');
  }
}

async function chaveHmac(segredo: string | undefined): Promise<CryptoKey> {
  if (!segredo) throw new Error('HMAC_2FA_SEGREDO ausente');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

const mensagem = (usuarioId: string, codigo: string) =>
  new TextEncoder().encode(`${usuarioId}:${codigo}`);

export async function hmacDoCodigo(
  segredo: string | undefined,
  usuarioId: string,
  codigo: string,
): Promise<Buffer> {
  const assinatura = await crypto.subtle.sign(
    'HMAC',
    await chaveHmac(segredo),
    mensagem(usuarioId, codigo),
  );
  return Buffer.from(assinatura);
}

// Comparação em tempo constante, feita pelo próprio WebCrypto.
export async function codigoConfere(
  segredo: string | undefined,
  usuarioId: string,
  codigo: string,
  hmacGuardado: Uint8Array,
): Promise<boolean> {
  return crypto.subtle.verify(
    'HMAC',
    await chaveHmac(segredo),
    hmacGuardado,
    mensagem(usuarioId, codigo),
  );
}
