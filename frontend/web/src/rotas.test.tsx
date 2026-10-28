import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rotas } from './rotas.tsx';

// PUB-02: a página inicial do app renderiza em /app.

afterEach(cleanup);

describe('rotas do app', () => {
  it('renderiza a página inicial em /app', () => {
    const roteador = createMemoryRouter(rotas, { initialEntries: ['/app'] });

    render(<RouterProvider router={roteador} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Evolução Segura');
  });

  // Mudança aprovada pelo usuário em 2026-10-28: com a landing (PUB-01, T155), '/' deixa de ficar
  // sem página. A guarda continua: o Início do app não aparece fora de /app.
  it('em / renderiza a landing, não o Início do app', () => {
    const roteador = createMemoryRouter(rotas, { initialEntries: ['/'] });

    render(<RouterProvider router={roteador} />);

    expect(screen.getByRole('link', { name: 'Começar grátis' })).toBeTruthy();
    expect(roteador.state.location.pathname).toBe('/');
  });
});
