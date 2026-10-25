import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { aliasPg } from './vitest.alias-pg.ts';

// Postgres local do docker-compose (5433 no host). No CI, DATABASE_URL aponta para o serviço (5432).
const urlBanco =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/evolucao_segura';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: resolve(import.meta.dirname, '../../wrangler.jsonc') },
      miniflare: { hyperdrives: { HYPERDRIVE: urlBanco } },
    }),
  ],
  resolve: { alias: aliasPg },
  test: { passWithNoTests: true },
});
