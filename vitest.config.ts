import { defineConfig } from 'vitest/config';
import { aliasPg } from './backend/api/vitest.alias-pg.ts';

// Um projeto por pacote. Pacotes sem teste não quebram o `pnpm test`.
export default defineConfig({
  // O @cloudflare/vitest-plugin resolve os módulos do Worker pelo servidor Vite da raiz.
  resolve: { alias: aliasPg },
  test: {
    passWithNoTests: true,
    projects: [
      'backend/contrato',
      'backend/dominio',
      'backend/api',
      'backend/scripts',
      'frontend/web',
    ],
  },
});
