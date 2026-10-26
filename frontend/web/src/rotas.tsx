import { QueryClientProvider } from '@tanstack/react-query';
import { Outlet, type RouteObject } from 'react-router';
import { GuardaInatividade, SessaoExpirada } from './app/inatividade.tsx';
import { Inicio } from './app/inicio.tsx';
import { criarQueryClient } from './lib/api.ts';
import { Cadastro, Confirmar } from './publico/cadastro.tsx';
import { Entrar } from './publico/entrar.tsx';
import { Recuperar, Redefinir } from './publico/recuperar.tsx';

// PUB-02: o app fica sob /app. As páginas públicas ficam ao lado, fora deste prefixo.
// A raiz dá o cache do TanStack Query a todas as telas; a área /app tem o aviso de inatividade
// (AUTH-18, AUTH-19).

const clienteQuery = criarQueryClient();

function Raiz() {
  return (
    <QueryClientProvider client={clienteQuery}>
      <Outlet />
    </QueryClientProvider>
  );
}

function AreaDoApp() {
  return (
    <>
      <GuardaInatividade />
      <Outlet />
    </>
  );
}

export const rotas: RouteObject[] = [
  {
    element: <Raiz />,
    children: [
      { path: '/app', element: <AreaDoApp />, children: [{ index: true, element: <Inicio /> }] },
      { path: '/cadastro', element: <Cadastro /> },
      { path: '/confirmar', element: <Confirmar /> },
      { path: '/entrar', element: <Entrar /> },
      { path: '/recuperar', element: <Recuperar /> },
      { path: '/redefinir', element: <Redefinir /> },
      { path: '/sessao-expirada', element: <SessaoExpirada /> },
    ],
  },
];
