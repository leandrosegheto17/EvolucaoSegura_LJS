import { VERSAO_PRIVACIDADE, VERSAO_TERMOS } from '@es/contrato/identidade';
import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { rotas } from '../rotas.tsx';
import { DATA_TEXTOS } from './termos.tsx';

// T154 / CONTA-06, CAD-07: /termos e /privacidade em português, com versão e data iguais às
// gravadas no aceite (VERSAO_TERMOS, VERSAO_PRIVACIDADE), profissional como controlador, LJS como
// operadora e texto-base marcado para revisão jurídica.

afterEach(cleanup);

function abrir(url: string) {
  render(<RouterProvider router={createMemoryRouter(rotas, { initialEntries: [url] })} />);
}

describe('/termos', () => {
  it('mostra a versão gravada no aceite e a data', async () => {
    abrir('/termos');
    expect(await screen.findByRole('heading', { level: 1, name: /termos de uso/i })).toBeTruthy();
    expect(screen.getByText(`Versão ${VERSAO_TERMOS}`, { exact: false })).toBeTruthy();
    expect(screen.getByText(DATA_TEXTOS, { exact: false })).toBeTruthy();
  });

  it('define o profissional como controlador e a LJS como operadora', async () => {
    abrir('/termos');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/profissional é o controlador/i)).toBeTruthy();
    expect(screen.getByText(/LJS é a operadora/i)).toBeTruthy();
  });

  it('marca o texto como base para revisão jurídica', async () => {
    abrir('/termos');
    expect(await screen.findByText(/revisão jurídica/i)).toBeTruthy();
  });
});

describe('/privacidade', () => {
  it('mostra a versão da privacidade gravada no aceite e a data', async () => {
    abrir('/privacidade');
    expect(
      await screen.findByRole('heading', { level: 1, name: /política de privacidade/i }),
    ).toBeTruthy();
    expect(screen.getByText(`Versão ${VERSAO_PRIVACIDADE}`, { exact: false })).toBeTruthy();
    expect(screen.getByText(DATA_TEXTOS, { exact: false })).toBeTruthy();
  });

  it('define controlador e operadora, e avisa de backups por até 30 dias e do Asaas', async () => {
    abrir('/privacidade');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/profissional é o controlador/i)).toBeTruthy();
    expect(screen.getByText(/LJS é a operadora/i)).toBeTruthy();
    expect(screen.getByText(/backups por até 30 dias/i)).toBeTruthy();
    expect(screen.getByText(/Asaas/)).toBeTruthy();
  });

  it('marca o texto como base para revisão jurídica', async () => {
    abrir('/privacidade');
    expect(await screen.findByText(/revisão jurídica/i)).toBeTruthy();
  });
});
