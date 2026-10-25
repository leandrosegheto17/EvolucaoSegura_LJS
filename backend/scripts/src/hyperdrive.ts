// OPS-13: o Hyperdrive de produção é criado com o cache desligado, porque toda consulta do app lê
// dado que muda por ação do usuário. Este script só gera e documenta o comando; quem cria o
// recurso na Cloudflare é o dono do produto, na decisão do primeiro deploy.
//
// Como usar:
//   1. Exporte NEON_URL_APP com a URL direta do Neon (sem -pooler) da role app, sem mudar o
//      sslmode (ver .env.example e o spike set-local-hyperdrive). A URL é segredo: não grave.
//   2. Rode o comando impresso por `node backend/scripts/src/hyperdrive.ts`.
//   3. Copie o id devolvido para o "hyperdrive[0].id" do wrangler.jsonc.

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

if (import.meta.main) {
  process.stdout.write(`${comandoCriarHyperdrive()}\n`);
}
