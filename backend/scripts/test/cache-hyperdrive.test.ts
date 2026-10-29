import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  API_CLOUDFLARE,
  CacheRecusado,
  conferirCacheDesligado,
  conferirRespostaDoCache,
  idDoHyperdrive,
  main,
} from '../src/operacao/cache-hyperdrive.ts';

// OPS-13 (padrão Neon, item 7): o deploy confere pela API da Cloudflare que o cache do Hyperdrive
// está desligado e falha fechado em qualquer outra resposta. Nada aqui chama a Cloudflare: o fetch
// é simulado. Token, conta e id são fictícios.

const ID = '0123456789abcdef0123456789abcdef';
const CONTA = 'fedcba9876543210fedcba9876543210';
const TOKEN = 'token_ficticio-123';

const wrangler = (id: string, binding = 'HYPERDRIVE'): string => `{
  // comentário do JSONC
  "name": "x",
  "hyperdrive": [{ "binding": "${binding}", "id": "${id}", },],
}`;

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status });
}

const desligado = { success: true, result: { caching: { disabled: true } } };

describe('idDoHyperdrive', () => {
  it('lê o id do binding HYPERDRIVE de um JSONC com comentário e vírgula final', () => {
    expect(idDoHyperdrive(wrangler(ID))).toBe(ID);
  });

  it('recusa o placeholder só de zeros', () => {
    expect(() => idDoHyperdrive(wrangler('0'.repeat(32)))).toThrow(/placeholder/);
  });

  it.each([
    ['fora do formato', wrangler('abc')],
    ['sem o binding HYPERDRIVE', wrangler(ID, 'OUTRO')],
    ['sem hyperdrive', '{ "name": "x" }'],
    ['ilegível', '{ "hyperdrive": [ '],
  ])('recusa wrangler.jsonc %s', (_caso, texto) => {
    expect(() => idDoHyperdrive(texto)).toThrow(CacheRecusado);
  });

  it('o wrangler.jsonc do repositório tem o id real do Hyperdrive, e não o placeholder', () => {
    const texto = readFileSync(resolve(import.meta.dirname, '../../../wrangler.jsonc'), 'utf8');
    const id = idDoHyperdrive(texto);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toMatch(/^0+$/);
  });
});

describe('conferirRespostaDoCache', () => {
  it('passa só com success true e caching.disabled true', () => {
    expect(() => conferirRespostaDoCache(desligado)).not.toThrow();
  });

  it.each([
    ['cache ligado', { success: true, result: { caching: { disabled: false } } }],
    ['disabled como texto', { success: true, result: { caching: { disabled: 'true' } } }],
    ['sem caching', { success: true, result: {} }],
    ['sem result', { success: true }],
    ['success false', { success: false, result: { caching: { disabled: true } } }],
    ['corpo nulo', null],
  ])('falha com %s', (_caso, corpo) => {
    expect(() => conferirRespostaDoCache(corpo)).toThrow(CacheRecusado);
  });
});

describe('conferirCacheDesligado', () => {
  it('consulta a config do Hyperdrive da conta com o token no cabeçalho', async () => {
    const buscar = vi.fn(async () => resposta(desligado));

    await conferirCacheDesligado({ token: TOKEN, conta: CONTA, id: ID, fetch: buscar });

    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_CLOUDFLARE}/accounts/${CONTA}/hyperdrive/configs/${ID}`);
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('falha com resposta HTTP de erro', async () => {
    const buscar = vi.fn(async () => resposta({}, 403));
    await expect(
      conferirCacheDesligado({ token: TOKEN, conta: CONTA, id: ID, fetch: buscar }),
    ).rejects.toThrow(/403/);
  });

  it('falha com resposta que não é JSON', async () => {
    const buscar = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(
      conferirCacheDesligado({ token: TOKEN, conta: CONTA, id: ID, fetch: buscar }),
    ).rejects.toThrow(/JSON/);
  });

  it.each([
    ['token vazio', { token: '', conta: CONTA, id: ID }],
    ['token com espaço', { token: 'a b', conta: CONTA, id: ID }],
    ['conta vazia', { token: TOKEN, conta: '', id: ID }],
    ['id fora do formato', { token: TOKEN, conta: CONTA, id: 'x' }],
  ])('recusa %s sem chamar a API', async (_caso, opcoes) => {
    const buscar = vi.fn(async () => resposta(desligado));
    await expect(conferirCacheDesligado({ ...opcoes, fetch: buscar })).rejects.toThrow(
      CacheRecusado,
    );
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe('main (passo do deploy)', () => {
  const ambiente = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: CONTA };

  function saida() {
    const linhas: string[] = [];
    return {
      linhas,
      saida: { info: (m: string) => linhas.push(m), erro: (m: string) => linhas.push(m) },
    };
  }

  it('sai com 0 quando o cache está desligado', async () => {
    const { saida: s } = saida();
    const codigo = await main(
      ambiente,
      async () => resposta(desligado),
      () => wrangler(ID),
      s,
    );
    expect(codigo).toBe(0);
  });

  it('sai com 1 quando o cache está ligado', async () => {
    const { saida: s, linhas } = saida();
    const ligado = { success: true, result: { caching: { disabled: false } } };
    const codigo = await main(
      ambiente,
      async () => resposta(ligado),
      () => wrangler(ID),
      s,
    );
    expect(codigo).toBe(1);
    expect(linhas.join('\n')).toMatch(/ligado/);
  });

  it('sai com 1 com o placeholder, sem chamar a API', async () => {
    const buscar = vi.fn(async () => resposta(desligado));
    const { saida: s } = saida();
    expect(await main(ambiente, buscar, () => wrangler('0'.repeat(32)), s)).toBe(1);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('sai com 1 em erro de rede e não imprime o token', async () => {
    const { saida: s, linhas } = saida();
    const falhar = async (): Promise<Response> => {
      throw new Error(`falha de rede com Bearer ${TOKEN}`);
    };
    expect(await main(ambiente, falhar, () => wrangler(ID), s)).toBe(1);
    expect(linhas.join('\n')).not.toContain(TOKEN);
  });
});
