import type { RouteObject } from 'react-router';
import { Inicio } from './app/inicio.tsx';
import { Cadastro, Confirmar } from './publico/cadastro.tsx';

// PUB-02: o app fica sob /app. As páginas públicas ficam ao lado, fora deste prefixo.
export const rotas: RouteObject[] = [
  { path: '/app', element: <Inicio /> },
  { path: '/cadastro', element: <Cadastro /> },
  { path: '/confirmar', element: <Confirmar /> },
];
