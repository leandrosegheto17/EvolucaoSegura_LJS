import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// SPEC_DEVIATION: a T22 fala em "base /app", mas aqui o `base` do Vite fica '/'.
// Motivo: o Worker entrega frontend/web/dist na raiz (T24), e o
// prefixo /app é do roteamento (src/rotas.tsx), não dos arquivos gerados.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    // PUSH-01, PUSH-08 (T147): o service worker (src/pwa/sw.ts) vira /sw.js na raiz do dist, para
    // ter escopo /; o resto segue em assets/ com hash. Até a T156 trazer o vite-plugin-pwa.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        sw: resolve(import.meta.dirname, 'src/pwa/sw.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  // setup.ts copiado do legado (T64): matchers do jest-dom e do axe e cleanup após cada teste.
  test: { environment: 'jsdom', passWithNoTests: true, setupFiles: ['src/test/setup.ts'] },
});
