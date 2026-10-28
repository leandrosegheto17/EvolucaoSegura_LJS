// Trava de host: nenhum script nem teste escreve num banco remoto sem decisão explícita. Host local
// passa direto; host remoto exige `--alvo producao|dev` (as duas branches permanentes do Neon) e,
// além disso, `CI=true` ou a confirmação digitada com o host exato. Desenho adaptado do
// trava-host.ts do GestaoDaPelada_LJS. As mensagens citam só o host, nunca a URL (que tem senha).

export type Alvo = 'producao' | 'dev';
export const ALVOS: readonly Alvo[] = ['producao', 'dev'];

export interface OpcoesTrava {
  url: string | undefined;
  alvo?: string | undefined;
  ci?: string | undefined;
  // Devolve o que a pessoa digitou quando precisa confirmar o host remoto.
  confirmar?: () => string | Promise<string>;
}

export class HostRecusado extends Error {}

const HOSTS_LOCAIS = new Set(['localhost', '::1']);

function octetoValido(parte: string): boolean {
  return /^\d{1,3}$/.test(parte) && Number(parte) <= 255;
}

export function hostELocal(host: string): boolean {
  if (HOSTS_LOCAIS.has(host)) return true;
  const partes = host.split('.');
  return partes.length === 4 && partes.every(octetoValido) && partes[0] === '127';
}

export function eAlvo(valor: string | undefined): valor is Alvo {
  return ALVOS.includes(valor as Alvo);
}

// Extrai o host sem expor a URL. Lança `HostRecusado` se a URL for estranha.
export function hostDaUrl(url: string | undefined): string {
  if (!url) throw new HostRecusado('Conexão ausente: informe a URL do banco.');
  let analisada: URL;
  try {
    analisada = new URL(url);
  } catch {
    throw new HostRecusado('URL do banco inválida.');
  }
  if (analisada.protocol !== 'postgres:' && analisada.protocol !== 'postgresql:') {
    throw new HostRecusado('URL do banco precisa começar com postgres:// ou postgresql://.');
  }
  if (analisada.searchParams.has('host') || analisada.searchParams.has('hostaddr')) {
    throw new HostRecusado('URL do banco com host na consulta não é aceita.');
  }
  const bruto = analisada.hostname.toLowerCase();
  const host = bruto.startsWith('[') && bruto.endsWith(']') ? bruto.slice(1, -1) : bruto;
  if (!host) throw new HostRecusado('URL do banco sem host.');
  if (host.includes(',')) throw new HostRecusado('URL do banco com vários hosts não é aceita.');
  if (host.startsWith('/') || host.includes('%2f')) {
    throw new HostRecusado('Socket de banco não é aceito.');
  }
  return host;
}

// Só host local; qualquer outro lança. Para o que nunca deve tocar banco remoto (testes).
export function exigirHostLocal(url: string | undefined): string {
  const host = hostDaUrl(url);
  if (!hostELocal(host)) {
    throw new HostRecusado(`Host remoto (${host}): este caminho só aceita o Postgres local.`);
  }
  return host;
}

// Lança `HostRecusado` se o host não for local e o alvo não estiver autorizado.
export async function exigirHostPermitido(opcoes: OpcoesTrava): Promise<string> {
  const host = hostDaUrl(opcoes.url);
  if (hostELocal(host)) return host;

  if (!eAlvo(opcoes.alvo)) {
    throw new HostRecusado(`Host remoto (${host}): informe --alvo producao ou --alvo dev.`);
  }
  if (opcoes.ci === 'true') return host;
  const digitado = opcoes.confirmar ? (await opcoes.confirmar()).trim() : undefined;
  if (digitado !== host) {
    throw new HostRecusado(`Host remoto (${host}): confirmação ausente ou diferente do host.`);
  }
  return host;
}
