// CAD-03, AUTH-13, CONTA-02: tokens dos links de e-mail. 256 bits do CSPRNG do runtime, em
// base64url no link; no banco vai só o SHA-256 do texto do token (32 bytes). SHA-256 é barato:
// não conflita com o OPS-14, que proíbe só o hash de senha no Worker.

export interface TokenGerado {
  token: string;
  hash: Buffer;
}

export async function hashDoToken(token: string): Promise<Buffer> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

export async function gerarToken(): Promise<TokenGerado> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  return { token, hash: await hashDoToken(token) };
}

// AUTH-04, AUTH-17: token CSRF da sessão, derivado do próprio id da sessão por HMAC-SHA256 (o id,
// de 256 bits, é a chave). Não precisa de coluna no banco: o middleware recalcula a partir do
// cookie. Quem não lê o cookie (HttpOnly) não consegue calcular o token.
export async function csrfDaSessao(sid: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sid),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode('csrf'));
  return Buffer.from(assinatura).toString('base64url');
}
