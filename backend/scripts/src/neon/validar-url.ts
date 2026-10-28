import { UrlNeonRecusada, validarUrlNeon } from './url-neon.ts';

// Linha de comando dos workflows: `node backend/scripts/src/neon/validar-url.ts NEON_URL_BACKUP`
// lê a variável de ambiente com esse nome e sai com 1 se ela não passar em validarUrlNeon. Só os
// nomes NEON_URL_* são aceitos. Nunca imprime a URL.

export function validarVariavel(nome: string | undefined, ambiente: NodeJS.ProcessEnv): string {
  if (!nome || !/^NEON_URL_[A-Z0-9_]+$/.test(nome)) {
    throw new UrlNeonRecusada('Informe o nome de uma variável NEON_URL_*.');
  }
  validarUrlNeon(ambiente[nome], nome);
  return `${nome}: conexão direta do Neon com TLS.`;
}

if (import.meta.main) {
  try {
    process.stdout.write(`${validarVariavel(process.argv[2], process.env)}\n`);
  } catch (erro) {
    if (!(erro instanceof UrlNeonRecusada)) throw erro;
    process.stderr.write(`${erro.message}\n`);
    process.exitCode = 1;
  }
}
