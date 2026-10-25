import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// O `pg` carrega `pg-cloudflare` e `pg-protocol` com require() dentro do runtime do Worker, e as
// condições "workerd" e "import" desses pacotes entregam wrappers ESM que o require do Vitest não
// executa. Apontamos para o build CommonJS (dist/index.js) dos mesmos pacotes.
//
// O @cloudflare/vitest-plugin resolve módulos pelo servidor Vite da RAIZ, não pelo do projeto:
// por isso o alias precisa estar também no vitest.config.ts da raiz (que importa este arquivo).
const requireDoPg = createRequire(createRequire(import.meta.url).resolve('pg'));

export const aliasPg = {
  // A condição "require" do pg-protocol entrega dist/index.js.
  'pg-protocol': requireDoPg.resolve('pg-protocol'),
  // No Node, pg-cloudflare resolve para dist/empty.js; o CloudflareSocket está em dist/index.js.
  'pg-cloudflare': join(dirname(requireDoPg.resolve('pg-cloudflare')), 'index.js'),
};
