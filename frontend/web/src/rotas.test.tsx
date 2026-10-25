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

  it('não renderiza a página inicial fora do prefixo /app', () => {
    const roteador = createMemoryRouter(rotas, { initialEntries: ['/'] });

    render(<RouterProvider router={roteador} />);

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
