import { defineConfig } from 'vitest/config';

// Projeto mínimo só para o teste de preparar-banco-api: um globalSetup que migra um banco
// temporário dentro do processo do Vitest, como o da API, e um teste que sempre passa.
export default defineConfig({
  test: { include: ['./ok.test.ts'], globalSetup: ['./setup.ts'] },
});
