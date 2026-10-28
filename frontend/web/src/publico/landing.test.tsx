import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { rotas } from '../rotas.tsx';

// T155 / PUB-01: a raiz mostra proposta de valor, planos (Free até 5 pacientes ativos; Pro
// R$ 19,90/mês sem limite; trial de 14 dias) e o botão "Começar grátis" para /cadastro.

afterEach(cleanup);

function abrir() {
  const roteador = createMemoryRouter(rotas, { initialEntries: ['/'] });
  render(<RouterProvider router={roteador} />);
  return roteador;
}

describe('/ (landing)', () => {
  it('mostra a proposta de valor', async () => {
    abrir();
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByText(/prontuário/i)).toBeTruthy();
  });

  it('mostra o plano Free com até 5 pacientes ativos', async () => {
    abrir();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/até 5 pacientes ativos/i)).toBeTruthy();
  });

  it('mostra o plano Pro a R$ 19,90/mês sem limite de pacientes', async () => {
    abrir();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/R\$\s?19,90\/mês/)).toBeTruthy();
    expect(screen.getByText(/sem limite de pacientes/i)).toBeTruthy();
  });

  it('informa o trial de 14 dias', async () => {
    abrir();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByText(/14 dias/).length).toBeGreaterThan(0);
  });

  it('"Começar grátis" leva a /cadastro', async () => {
    const roteador = abrir();
    const link = await screen.findByRole('link', { name: 'Começar grátis' });
    expect(link.getAttribute('href')).toBe('/cadastro');
    fireEvent.click(link);
    expect(roteador.state.location.pathname).toBe('/cadastro');
  });
});
