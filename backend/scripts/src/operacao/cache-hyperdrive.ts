import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';

// OPS-13 (padrão Neon, item 7): confere, no deploy, que o cache de consultas do Hyperdrive está
// DESLIGADO. Com cache ligado, a mesma consulta de dois profissionais (mesmo texto e parâmetros,
// só o app.usuario_id muda) poderia devolver a um o resultado do outro. Passo do deploy.yml ANTES
// do dump, da migração e da publicação do Worker: falha fechado em qualquer coisa que não seja
// `caching.disabled === true`. Desenho adaptado do cache-hyperdrive.ts do ControleEmCasa_LJS.
//
// O id vem do wrangler.jsonc (o mesmo que o deploy publica); o placeholder (só zeros) faz o passo
// falhar. O token da Cloudflare vem só do ambiente (CLOUDFLARE_API_TOKEN) e nunca vai ao log.

export const API_CLOUDFLARE = 'https://api.cloudflare.com/client/v4';
const ID_VALIDO = /^[0-9a-f]{32}$/;
const TOKEN_VALIDO = /^[A-Za-z0-9_-]+$/;

export class CacheRecusado extends Error {}

// Id do único Hyperdrive com binding HYPERDRIVE. Placeholder, ausente ou fora do formato: lança.
export function idDoHyperdrive(wranglerJsonc: string): string {
  const erros: ParseError[] = [];
  const config = parse(wranglerJsonc, erros, { allowTrailingComma: true }) as {
    hyperdrive?: { binding?: unknown; id?: unknown }[];
  };
  if (erros.length > 0 || typeof config !== 'object' || config === null) {
    throw new CacheRecusado('wrangler.jsonc ilegível.');
  }
  const lista = (config.hyperdrive ?? []).filter((h) => h.binding === 'HYPERDRIVE');
  if (lista.length !== 1) {
    throw new CacheRecusado('wrangler.jsonc sem exatamente um Hyperdrive com binding HYPERDRIVE.');
  }
  const id = lista[0]?.id;
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) {
    throw new CacheRecusado('Id do Hyperdrive fora do formato no wrangler.jsonc.');
  }
  if (/^0+$/.test(id)) {
    throw new CacheRecusado(
      'Id do Hyperdrive ainda é o placeholder (só zeros): crie o de produção (runbook, 8.5).',
    );
  }
  return id;
}

// Só passa com `success === true` e `result.caching.disabled === true` (booleano).
export function conferirRespostaDoCache(corpo: unknown): void {
  const { success, result } = (corpo ?? {}) as {
    success?: unknown;
    result?: { caching?: { disabled?: unknown } };
  };
  if (success !== true) throw new CacheRecusado('A API do Hyperdrive não respondeu com sucesso.');
  if (result?.caching?.disabled !== true) {
    throw new CacheRecusado(
      'Cache do Hyperdrive ligado ou ausente na resposta (OPS-13): desligue antes do deploy.',
    );
  }
}

export interface OpcoesCache {
  token: string;
  conta: string;
  id: string;
  fetch?: typeof fetch;
}

export async function conferirCacheDesligado({
  token,
  conta,
  id,
  fetch: buscar = fetch,
}: OpcoesCache): Promise<void> {
  if (!TOKEN_VALIDO.test(token)) {
    throw new CacheRecusado('CLOUDFLARE_API_TOKEN ausente ou fora do formato.');
  }
  if (!ID_VALIDO.test(conta)) {
    throw new CacheRecusado('CLOUDFLARE_ACCOUNT_ID ausente ou fora do formato.');
  }
  if (!ID_VALIDO.test(id)) throw new CacheRecusado('Id do Hyperdrive fora do formato.');
  const resposta = await buscar(`${API_CLOUDFLARE}/accounts/${conta}/hyperdrive/configs/${id}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!resposta.ok) throw new CacheRecusado(`A API do Hyperdrive respondeu ${resposta.status}.`);
  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    throw new CacheRecusado('Resposta da API do Hyperdrive não é JSON.');
  }
  conferirRespostaDoCache(corpo);
}

const WRANGLER = resolve(import.meta.dirname, '../../../../wrangler.jsonc');

export interface Saida {
  info: (mensagem: string) => void;
  erro: (mensagem: string) => void;
}

// Devolve o código de saída. Qualquer falha (inclusive de rede) dá 1, só com a mensagem.
export async function main(
  ambiente: NodeJS.ProcessEnv = process.env,
  buscar: typeof fetch = fetch,
  wranglerJsonc: () => string = () => readFileSync(WRANGLER, 'utf8'),
  saida: Saida = {
    info: (mensagem) => process.stdout.write(`${mensagem}\n`),
    erro: (mensagem) => process.stderr.write(`${mensagem}\n`),
  },
): Promise<number> {
  try {
    await conferirCacheDesligado({
      token: ambiente['CLOUDFLARE_API_TOKEN'] ?? '',
      conta: ambiente['CLOUDFLARE_ACCOUNT_ID'] ?? '',
      id: idDoHyperdrive(wranglerJsonc()),
      fetch: buscar,
    });
    saida.info('Cache do Hyperdrive desligado.');
    return 0;
  } catch (erro) {
    saida.erro(
      erro instanceof CacheRecusado ? erro.message : 'Falha ao consultar a API do Hyperdrive.',
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
