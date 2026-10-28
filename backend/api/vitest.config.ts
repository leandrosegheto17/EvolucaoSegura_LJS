import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { aliasPg } from './vitest.alias-pg.ts';
import { urlBancoAdmin, urlBancoApp } from './vitest.urls.ts';

// HYPERDRIVE conecta como a role evolucao_app, como em produção (RLS valendo). HYPERDRIVE_ADMIN existe só
// nos testes: superusuário para semear e conferir dados que o RLS esconde da app.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: resolve(import.meta.dirname, '../../wrangler.jsonc') },
      miniflare: {
        hyperdrives: { HYPERDRIVE: urlBancoApp, HYPERDRIVE_ADMIN: urlBancoAdmin },
        // Sem MAIL_FROM nem RESEND_API_KEY: os testes injetam um e-mail simulado.
        // HMAC_2FA_SEGREDO e ASAAS_WEBHOOK_TOKEN são de teste (não são segredo de nenhum ambiente real).
        bindings: {
          URL_PUBLICA: 'http://localhost:8787',
          HMAC_2FA_SEGREDO: 'segredo-de-teste-do-hmac-2fa-com-32-ou-mais',
          // Token de teste do webhook do Asaas (não é o de nenhum ambiente real).
          ASAAS_WEBHOOK_TOKEN: 'token-de-teste-do-webhook-asaas-com-32-ou-mais',
        },
      },
    }),
  ],
  resolve: { alias: aliasPg },
  test: { passWithNoTests: true, globalSetup: ['./test/preparar-banco.ts'] },
});
