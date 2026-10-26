import { QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Outlet, type RouteObject } from 'react-router';
import { NovaSessaoPage } from './app/agenda/agenda.tsx';
import { AgendaComAcoes, NovaSeriePage } from './app/agenda/serie.tsx';
import { GuardaInatividade, SessaoExpirada } from './app/inatividade.tsx';
import { Inicio } from './app/inicio.tsx';
import { PatientFichaPage } from './app/pacientes/ficha.tsx';
import { PatientFormPage } from './app/pacientes/novo.tsx';
import { PatientsListPage } from './app/pacientes/pacientes.tsx';
import { PatientStatusPage } from './app/pacientes/situacao.tsx';
import { SettingsPage } from './app/perfil/configuracoes.tsx';
import { ProfilePage } from './app/perfil/perfil.tsx';
import { GuardaPerfil, Shell } from './app/shell.tsx';
import { criarQueryClient } from './lib/api.ts';
import { Cadastro, Confirmar } from './publico/cadastro.tsx';
import { Entrar } from './publico/entrar.tsx';
import { Recuperar, Redefinir } from './publico/recuperar.tsx';

// PUB-02: o app fica sob /app. As páginas públicas ficam ao lado, fora deste prefixo.
// A raiz dá o cache do TanStack Query a todas as telas; a área /app tem o aviso de inatividade
// (AUTH-18, AUTH-19), a guarda de perfil (PERF-01) e o shell portado do legado.
// PREMISSA: rota de /app que ainda não existe (as telas chegam etapa a etapa) volta ao Início,
// passando antes pela guarda de perfil.

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
      {
        path: '/app',
        element: <AreaDoApp />,
        children: [
          {
            element: <GuardaPerfil />,
            children: [
              {
                element: <Shell />,
                children: [
                  { index: true, element: <Inicio /> },
                  { path: 'perfil', element: <ProfilePage /> },
                  { path: 'configuracoes', element: <SettingsPage /> },
                  { path: 'agenda', element: <AgendaComAcoes /> },
                  { path: 'agenda/nova', element: <NovaSessaoPage /> },
                  { path: 'agenda/serie/nova', element: <NovaSeriePage /> },
                  { path: 'pacientes', element: <PatientsListPage /> },
                  { path: 'pacientes/novo', element: <PatientFormPage /> },
                  { path: 'pacientes/:id', element: <PatientFichaPage /> },
                  { path: 'pacientes/:id/situacao', element: <PatientStatusPage /> },
                  { path: '*', element: <Navigate to="/app" replace /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '/cadastro', element: <Cadastro /> },
      { path: '/confirmar', element: <Confirmar /> },
      { path: '/entrar', element: <Entrar /> },
      { path: '/recuperar', element: <Recuperar /> },
      { path: '/redefinir', element: <Redefinir /> },
      { path: '/sessao-expirada', element: <SessaoExpirada /> },
    ],
  },
];
