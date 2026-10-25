import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { rotas } from './rotas.tsx';
import './estilos.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado');

createRoot(raiz).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(rotas)} />
  </StrictMode>,
);
