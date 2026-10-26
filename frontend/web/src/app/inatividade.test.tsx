import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTO_NAO_AUTORIZADO, EVENTO_SESSAO_USADA, definirCsrf, lerCsrf } from '../lib/api.ts';
import { rotas } from '../rotas.tsx';
import { GuardaInatividade, SessaoExpirada } from './inatividade.tsx';

// T60 / AUTH-18, AUTH-19: aviso de inatividade e sessão expirada (relógio simulado).
// - a sessão do servidor acaba 15 min depois da última requisição autenticada (AUTH-09); aos
//   13:00 sem requisição o app mostra "Sua sessão vai expirar" com a contagem dos últimos 120 s;
// - "Continuar conectado" renova a sessão (GET /api/eu) e a contagem recomeça;
// - aos 15:00 o app limpa o cache, esquece o token CSRF e vai para /sessao-expirada, sem apagar
//   os rascunhos guardados no navegador.

const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  definirCsrf('token-da-sessao');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function montar() {
  const clienteQuery = new QueryClient();
  clienteQuery.setQueryData(['pacientes'], [{ nome: 'Paciente de teste' }]);
  const roteador = createMemoryRouter(
    [
      {
        path: '/app/pacientes',
        element: (
          <>
            <GuardaInatividade />
            <p>Lista de pacientes</p>
          </>
        ),
      },
      { path: '/sessao-expirada', element: <SessaoExpirada /> },
    ],
    { initialEntries: ['/app/pacientes'] },
  );
  render(
    <QueryClientProvider client={clienteQuery}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
  return { clienteQuery, roteador };
}

const avancar = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const dialogo = () => screen.queryByRole('alertdialog');

function simularEu() {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    void [url, init];
    return new Response(JSON.stringify({ csrf_token: 'token-renovado' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('aviso de inatividade (AUTH-18)', () => {
  it('não aparece antes dos 13:00 sem requisição', () => {
    montar();
    avancar(13 * MIN - 1_000);
    expect(dialogo()).toBeNull();
  });

  it('aparece aos 13:00 com o título e a contagem de 2:00', () => {
    montar();
    avancar(13 * MIN);

    const aviso = dialogo();
    expect(aviso).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Sua sessão vai expirar' })).toBeTruthy();
    expect(aviso!.textContent).toContain('2:00');
  });

  it('a contagem desce a cada segundo', () => {
    montar();
    avancar(13 * MIN);
    avancar(30_000);
    expect(dialogo()!.textContent).toContain('1:30');
    avancar(29_000);
    expect(dialogo()!.textContent).toContain('1:01');
  });

  it('o foco vai para "Continuar conectado"', () => {
    montar();
    avancar(13 * MIN);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Continuar conectado' }),
    );
  });

  it('cada requisição autenticada recomeça a contagem da inatividade', () => {
    montar();
    avancar(10 * MIN);
    act(() => void window.dispatchEvent(new Event(EVENTO_SESSAO_USADA)));

    avancar(13 * MIN - 1_000);
    expect(dialogo()).toBeNull();
    avancar(1_000);
    expect(dialogo()).not.toBeNull();
  });

  it('"Continuar conectado" renova a sessão em GET /api/eu e fecha o aviso', async () => {
    const f = simularEu();
    montar();
    avancar(13 * MIN);

    fireEvent.click(screen.getByRole('button', { name: 'Continuar conectado' }));

    await vi.waitFor(() => {
      expect(dialogo()).toBeNull();
      expect(lerCsrf()).toBe('token-renovado');
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('/api/eu');
  });

  it('depois de renovar, o aviso só volta 13:00 depois da renovação e a sessão não expira aos 15:00', async () => {
    simularEu();
    const { roteador } = montar();
    avancar(13 * MIN);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar conectado' }));
    await vi.waitFor(() => expect(dialogo()).toBeNull());

    avancar(2 * MIN);
    expect(roteador.state.location.pathname).toBe('/app/pacientes');
    avancar(11 * MIN - 1_000);
    expect(dialogo()).toBeNull();
    avancar(1_000);
    expect(dialogo()).not.toBeNull();
  });

  it('Esc também renova (nunca encerra)', async () => {
    const f = simularEu();
    montar();
    avancar(13 * MIN);

    fireEvent.keyDown(dialogo()!, { key: 'Escape' });

    await vi.waitFor(() => expect(dialogo()).toBeNull());
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('sessão expirada (AUTH-19)', () => {
  it('aos 15:00 sem requisição leva a /sessao-expirada', () => {
    const { roteador } = montar();
    avancar(15 * MIN - 1_000);
    expect(roteador.state.location.pathname).toBe('/app/pacientes');

    avancar(1_000);

    expect(roteador.state.location.pathname).toBe('/sessao-expirada');
    expect(screen.getByRole('heading', { name: 'Sessão expirada' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /entrar novamente/i }).getAttribute('href')).toBe(
      '/entrar',
    );
  });

  it('a expiração limpa os dados em cache e esquece o token CSRF', () => {
    const { clienteQuery } = montar();
    expect(clienteQuery.getQueryData(['pacientes'])).toBeDefined();

    avancar(15 * MIN);

    expect(clienteQuery.getQueryCache().getAll()).toEqual([]);
    expect(lerCsrf()).toBeNull();
  });

  it('a expiração mantém os rascunhos guardados no navegador', () => {
    localStorage.setItem('es:rascunho:evolucao:123', '{"texto":"anotação não salva"}');
    sessionStorage.setItem('es:rascunho:anamnese:456', '{"campo":"x"}');
    montar();

    avancar(15 * MIN);

    expect(localStorage.getItem('es:rascunho:evolucao:123')).toBe('{"texto":"anotação não salva"}');
    expect(sessionStorage.getItem('es:rascunho:anamnese:456')).toBe('{"campo":"x"}');
  });

  it('a página de sessão expirada avisa que os rascunhos foram preservados', () => {
    montar();
    avancar(15 * MIN);
    expect(document.body.textContent).toMatch(/rascunho/i);
  });

  it('401 de qualquer requisição (sessão encerrada no servidor) também limpa o cache', () => {
    const { clienteQuery } = montar();

    act(() => void window.dispatchEvent(new Event(EVENTO_NAO_AUTORIZADO)));

    expect(clienteQuery.getQueryCache().getAll()).toEqual([]);
  });
});

describe('rotas (AUTH-18, AUTH-19)', () => {
  it('a área /app tem o aviso de inatividade', () => {
    const roteador = createMemoryRouter(rotas, { initialEntries: ['/app'] });
    render(<RouterProvider router={roteador} />);

    avancar(13 * MIN);

    expect(screen.getByRole('heading', { name: 'Sua sessão vai expirar' })).toBeTruthy();
  });

  it('/sessao-expirada existe fora de /app', () => {
    const roteador = createMemoryRouter(rotas, { initialEntries: ['/sessao-expirada'] });
    render(<RouterProvider router={roteador} />);
    expect(screen.getByRole('heading', { name: 'Sessão expirada' })).toBeTruthy();
  });
});
