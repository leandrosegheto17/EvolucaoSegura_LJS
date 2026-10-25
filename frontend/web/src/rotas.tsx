import type { RouteObject } from 'react-router';
import { Inicio } from './app/inicio.tsx';

// PUB-02: o app fica sob /app. As páginas públicas (landing, cadastro...) entram ao lado, fora
// deste prefixo, nas etapas seguintes.
export const rotas: RouteObject[] = [{ path: '/app', element: <Inicio /> }];
