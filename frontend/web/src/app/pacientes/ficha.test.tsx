import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { PatientFichaPage } from './ficha.tsx';

// T73 / PAC-03, PAC-05, PAC-06: ficha do paciente. Casos de
// patients/ficha/PatientFichaPage.spec.tsx do legado que valem sem IA, sem edição dos dados e
// antes das telas de anamnese e prontuário: cabeçalho com nome e selo de situação, menu "Editar"
// com "Situação do paciente" (por mouse e por teclado), cartão Consentimentos com o TCLE e
// acessibilidade nos dois temas.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  definirCsrf(null);
  delete document.documentElement.dataset['theme'];
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const PAC = {
  id: 'p1',
  nome: 'Bruno Lima',
  telefone: null,
  email: null,
  endereco: null,
  ativo: true,
  row_version: 1,
  criado_em: '2026-10-01T12:00:00.000Z',
};

function mock(o: { ativo?: boolean; status?: number } = {}) {
  const f = vi.fn(async (url: string) => {
    if (url.endsWith('/tcle')) return json({ items: [] });
    if (o.status) return json({ codigo: 'nao_encontrado' }, o.status);
    return json({ ...PAC, ativo: o.ativo ?? true });
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/app/pacientes/p1']}>
        <Routes>
          <Route path="/app/pacientes/:id" element={<PatientFichaPage />} />
          <Route path="/app/pacientes/:id/situacao" element={<p>tela situação</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Ficha do paciente', () => {
  it('abre pela API do paciente e mostra o nome, o selo Ativo e o cartão Consentimentos', async () => {
    const f = mock();
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Bruno Lima' })).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Consentimentos' })).toBeTruthy();
    expect(await screen.findByText('Nenhum TCLE registrado.')).toBeTruthy();
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(
      expect.arrayContaining(['/api/pacientes/p1', '/api/pacientes/p1/tcle']),
    );
  });

  it('paciente inativo mostra o selo Inativo', async () => {
    mock({ ativo: false });
    setup();
    expect(await screen.findByText('Inativo')).toBeTruthy();
  });

  it('sem ciência de IA, sem editar dados e sem excluir', async () => {
    mock();
    setup();
    await screen.findByRole('heading', { level: 1, name: 'Bruno Lima' });
    expect(screen.queryByText(/ciência de IA|Ciente de IA/)).toBeNull();
    expect(screen.queryByRole('button', { name: /exclu/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const itens = screen.getAllByRole('menuitem');
    expect(itens.map((i) => i.textContent)).toEqual(['Situação do paciente']);
  });

  it('"Editar" (menu) leva à situação do paciente, por mouse', async () => {
    mock();
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const item = screen.getByRole('menuitem', { name: 'Situação do paciente' });
    expect(item.getAttribute('href')).toBe('/app/pacientes/p1/situacao');
    await userEvent.click(item);
    expect(await screen.findByText('tela situação')).toBeTruthy();
  });

  it('"Editar" por teclado abre o menu e Enter segue o item', async () => {
    mock();
    setup();
    const botao = await screen.findByRole('button', { name: 'Editar' });
    botao.focus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByText('tela situação')).toBeTruthy();
  });

  it('paciente não encontrado (404) mostra erro com Tentar novamente', async () => {
    mock({ status: 404 });
    setup();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar o paciente.');
    expect(within(alerta).getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it.each(['light', 'dark'] as const)('sem violações axe (tema %s)', async (tema) => {
    document.documentElement.dataset['theme'] = tema;
    mock();
    const { container } = setup();
    await screen.findByText('Nenhum TCLE registrado.');
    expect((await axe(container)).violations).toEqual([]);
  });
});
