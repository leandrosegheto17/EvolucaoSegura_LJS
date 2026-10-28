import { HostRecusado, hostDaUrl, hostELocal } from '../seguranca/trava-host.ts';

// Validação única de toda URL que conecta no Neon (migração do deploy, backup, criação do
// Hyperdrive e `pnpm migrar --alvo`). Recusa: host local, host fora de `.neon.tech`, host do
// pooler (`-pooler`: o pg_dump e o Hyperdrive precisam da conexão direta), conexão sem TLS
// exigido (`sslmode` precisa ser require, verify-ca ou verify-full) e banco que não seja o
// `evolucao` (nome padronizado do database no Neon, igual nas branches main e dev). As mensagens citam só o nome
// da variável e o host, nunca a URL (que tem senha).

const SSLMODES_COM_TLS = new Set(['require', 'verify-ca', 'verify-full']);
const DOMINIO_NEON = '.neon.tech';
export const BANCO_NEON = 'evolucao';

export class UrlNeonRecusada extends Error {}

export interface UrlNeon {
  host: string;
  banco: string;
}

export function validarUrlNeon(url: string | undefined, variavel = 'URL do Neon'): UrlNeon {
  let host: string;
  try {
    host = hostDaUrl(url);
  } catch (erro) {
    if (erro instanceof HostRecusado) throw new UrlNeonRecusada(`${variavel}: ${erro.message}`);
    throw erro;
  }
  if (hostELocal(host)) {
    throw new UrlNeonRecusada(`${variavel}: host local (${host}) não é o Neon.`);
  }
  const rotulos = host.split('.');
  if (!host.endsWith(DOMINIO_NEON) || rotulos.length < 3 || rotulos.some((r) => r === '')) {
    throw new UrlNeonRecusada(`${variavel}: host ${host} não é do Neon (*${DOMINIO_NEON}).`);
  }
  if (host.includes('-pooler')) {
    throw new UrlNeonRecusada(
      `${variavel}: host ${host} é o pooler; use a conexão direta (sem -pooler).`,
    );
  }
  const analisada = new URL(url as string);
  if (analisada.pathname !== `/${BANCO_NEON}` || analisada.searchParams.has('dbname')) {
    throw new UrlNeonRecusada(`${variavel}: o banco no Neon precisa ser o ${BANCO_NEON}.`);
  }
  const parametros = analisada.searchParams;
  const sslmodes = parametros.getAll('sslmode');
  if (sslmodes.length !== 1 || !SSLMODES_COM_TLS.has(sslmodes[0] as string)) {
    throw new UrlNeonRecusada(
      `${variavel}: exija TLS com um único sslmode=require, verify-ca ou verify-full.`,
    );
  }
  return { host, banco: BANCO_NEON };
}
