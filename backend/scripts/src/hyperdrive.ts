// OPS-13: o Hyperdrive de produção é criado com o cache desligado, porque toda consulta do app lê
// dado que muda por ação do usuário. Este script só gera e documenta o comando; quem cria o
// recurso na Cloudflare é o dono do produto, na decisão do primeiro deploy.
//
// Como usar:
//   1. Exporte NEON_URL_APP com a URL direta do Neon (sem -pooler) da role evolucao_app, sem mudar o
//      sslmode (ver .env.example e o spike set-local-hyperdrive). A URL é segredo: não grave.
//   2. Rode `node backend/scripts/src/hyperdrive.ts`: ele valida a NEON_URL_APP (validarUrlNeon:
//      Neon, conexão direta, TLS) e só então imprime o comando; URL inválida sai com 1. Rode o
//      comando impresso.
//   3. Copie o id devolvido para o "hyperdrive[0].id" do wrangler.jsonc.

import { UrlNeonRecusada, validarUrlNeon } from './neon/url-neon.ts';

export const NOME_HYPERDRIVE = 'evolucao-segura';
export const VARIAVEL_CONEXAO = 'NEON_URL_APP';

export function comandoCriarHyperdrive(): string {
  return [
    'wrangler hyperdrive create',
    NOME_HYPERDRIVE,
    `--connection-string="$${VARIAVEL_CONEXAO}"`,
    '--caching-disabled',
  ].join(' ');
}

// Valida a URL do ambiente e devolve o comando; lança UrlNeonRecusada se a URL não servir.
export function comandoValidado(ambiente: NodeJS.ProcessEnv): string {
  validarUrlNeon(ambiente[VARIAVEL_CONEXAO], VARIAVEL_CONEXAO);
  return comandoCriarHyperdrive();
}

if (import.meta.main) {
  try {
    process.stdout.write(`${comandoValidado(process.env)}\n`);
  } catch (erro) {
    if (!(erro instanceof UrlNeonRecusada)) throw erro;
    process.stderr.write(`${erro.message}\n`);
    process.exitCode = 1;
  }
}
