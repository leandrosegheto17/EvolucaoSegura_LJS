import { defineConfig } from 'vitest/config';

// Um projeto por pacote. Pacotes sem teste não quebram o `pnpm test`.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: ['backend/contrato', 'backend/dominio', 'backend/api', 'backend/scripts', 'frontend/web'],
  },
});
