import { defineConfig, devices } from '@playwright/test';
import { PORTA_COLETOR, RAIZ, URL_APP, URL_COLETOR } from './apoio/config.ts';

// OPS-05: e2e com o Worker local (wrangler dev), o Postgres do docker-compose e o e-mail
// capturado por um coletor local. `pnpm e2e` sobe tudo e derruba ao fim.
// Um worker só: os specs dividem o banco e o limite por IP do Worker (10 acessos por minuto).
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: URL_APP, trace: 'retain-on-failure', locale: 'pt-BR' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/apoio/coletor-email.ts',
      cwd: RAIZ,
      url: `${URL_COLETOR}/saude`,
      reuseExistingServer: !process.env['CI'],
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
      name: `coletor de e-mail (${PORTA_COLETOR})`,
    },
    {
      command: 'node e2e/apoio/iniciar-worker.ts',
      cwd: RAIZ,
      url: `${URL_APP}/api/health`,
      timeout: 240_000,
      reuseExistingServer: !process.env['CI'],
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      name: 'Worker local',
    },
  ],
});
