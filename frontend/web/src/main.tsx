import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { rotas } from './rotas.tsx';
import { iniciarSentry } from './sentry.ts';
import './estilos.css';

iniciarSentry({
  VITE_SENTRY_DSN: import.meta.env['VITE_SENTRY_DSN'],
  VITE_SENTRY_RELEASE: import.meta.env['VITE_SENTRY_RELEASE'],
});

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado');

createRoot(raiz).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(rotas)} />
  </StrictMode>,
);
