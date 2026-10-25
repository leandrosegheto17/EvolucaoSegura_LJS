import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { aliasPg } from './vitest.alias-pg.ts';
import { urlBancoAdmin, urlBancoApp } from './vitest.urls.ts';

// HYPERDRIVE conecta como a role app, como em produção (RLS valendo). HYPERDRIVE_ADMIN existe só
// nos testes: superusuário para semear e conferir dados que o RLS esconde da app.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: resolve(import.meta.dirname, '../../wrangler.jsonc') },
      miniflare: { hyperdrives: { HYPERDRIVE: urlBancoApp, HYPERDRIVE_ADMIN: urlBancoAdmin } },
    }),
  ],
  resolve: { alias: aliasPg },
  test: { passWithNoTests: true, globalSetup: ['./test/preparar-banco.ts'] },
});
