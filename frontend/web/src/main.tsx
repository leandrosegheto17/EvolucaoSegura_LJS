import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { initTheme } from './app/theme.ts';
import { registrarSwNoApp } from './pwa/offline.ts';
import { rotas } from './rotas.tsx';
import { iniciarSentry } from './sentry.ts';
import './estilos.css';

iniciarSentry({
  VITE_SENTRY_DSN: import.meta.env['VITE_SENTRY_DSN'],
  VITE_SENTRY_RELEASE: import.meta.env['VITE_SENTRY_RELEASE'],
});

// PUB-03: service worker (precache do shell e página offline) só no build de produção.
if (import.meta.env.PROD) void registrarSwNoApp(navigator.serviceWorker);

// Tema salvo (claro, escuro ou do aparelho) antes do primeiro render, como no legado.
initTheme();

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado');

createRoot(raiz).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(rotas)} />
  </StrictMode>,
);
