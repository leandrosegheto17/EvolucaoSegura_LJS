import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// SPEC_DEVIATION: a T22 fala em "base /app", mas aqui o `base` do Vite fica '/'.
// Motivo: o Worker entrega frontend/web/dist na raiz (T24), e o
// prefixo /app é do roteamento (src/rotas.tsx), não dos arquivos gerados.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  test: { environment: 'jsdom', passWithNoTests: true },
});
