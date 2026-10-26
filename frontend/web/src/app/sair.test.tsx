import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { definirCsrf, lerCsrf } from '../lib/api.ts';
import { useSignOut } from './sair.ts';

// T65 / AUTH-16, PUB-02: "Sair" do menu da conta (signOut.ts do legado). Avisa o servidor com
// POST /api/auth/sair (escrita autenticada, com o x-csrf-token), esquece o token e o cache do
// TanStack Query e vai para /entrar. Falha do servidor não impede a saída.

afterEach(() => vi.unstubAllGlobals());

function BotaoSair() {
  const sair = useSignOut();
  return (
    <button type="button" onClick={sair}>
      Sair
    </button>
  );
}

function montar(status: number) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    void [url, init];
    return new Response(null, { status });
  });
  vi.stubGlobal('fetch', f);
  definirCsrf('token-da-sessao');
  const qc = new QueryClient();
  qc.setQueryData(['pacientes'], [{ nome: 'Paciente de teste' }]);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<BotaoSair />} />
          <Route path="/entrar" element={<h1>Entrar</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { f, qc };
}

describe('sair (AUTH-16)', () => {
  it('chama POST /api/auth/sair com o token, limpa token e cache e vai para /entrar', async () => {
    const { f, qc } = montar(204);

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/auth/sair');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe('token-da-sessao');
    expect(lerCsrf()).toBeNull();
    expect(qc.getQueryCache().getAll()).toEqual([]);
  });

  it('falha do servidor não impede a saída', async () => {
    montar(500);

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(lerCsrf()).toBeNull();
  });
});
