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
