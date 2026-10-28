import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { manifesto } from './src/pwa/manifesto.ts';

import { defineConfig } from 'vitest/config';

// SPEC_DEVIATION: a T22 fala em "base /app", mas aqui o `base` do Vite fica '/'.
// Motivo: o Worker entrega frontend/web/dist na raiz (T24), e o
// prefixo /app é do roteamento (src/rotas.tsx), não dos arquivos gerados.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PUB-03 (T156): manifest e service worker próprio (src/pwa/sw.ts, com os handlers de push),
    // servido em /sw.js. o precache do shell e a página offline estão em src/pwa/offline.ts (T184).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: manifesto,
    }),
  ],
  build: { outDir: 'dist' },
  // setup.ts copiado do legado (T64): matchers do jest-dom e do axe e cleanup após cada teste.
  test: { environment: 'jsdom', passWithNoTests: true, setupFiles: ['src/test/setup.ts'] },
});
