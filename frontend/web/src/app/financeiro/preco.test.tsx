import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { PrecoPacientePage, PrecoSessaoPage, paraCentavos } from './preco.tsx';

// T166 / FIN-09: telas de preço. Casos de billing/price (PriceEditor.spec, usePriceEditor.spec,
// PatientPricePage.spec) do legado, para /api/pacientes/:id/preco e /api/sessoes/:id/preco com
// centavos inteiros (ADR-007).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  definirCsrf(null);
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const preco = (valor: number, v = 1) => ({
  paciente_id: 'p1',
  valor,
  row_version: v,
  criado_em: '2026-10-26T10:00:00.000Z',
});
const naoEncontrado = () => json({ codigo: 'nao_encontrado' }, 404);

/** `gets`: respostas sucessivas do GET (depois delas, 404); `puts`: respostas do PUT. */
function setup(url: string, gets: Response[], puts: Response[] = []) {
  const f = vi.fn<(u: string, init?: RequestInit) => Promise<Response>>(async (u, init) => {
    if (u === '/api/eu') return json({ csrf_token: 't' });
    if (init?.method === 'PUT') return puts.shift() ?? json({}, 500);
    return gets.shift() ?? naoEncontrado();
  });
  vi.stubGlobal('fetch', f);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <main>
          <Routes>
            <Route path="/app/financeiro/preco/paciente/:id" element={<PrecoPacientePage />} />
            <Route path="/app/financeiro/preco/sessao/:id" element={<PrecoSessaoPage />} />
          </Routes>
        </main>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return f;
}
const puts = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
    .map((c) => ({ url: String(c[0]), corpo: JSON.parse(String((c[1] as RequestInit).body)) }));

describe('paraCentavos: reais digitados viram centavos inteiros', () => {
  it.each([
    ['150', 15000],
    ['150,5', 15050],
    ['150.50', 15050],
    ['1.234,56', 123456],
    ['R$ 0,99', 99],
    ['0', 0],
    ['99.999.999,99', 9999999999],
  ])('%s -> %s', (texto, esperado) => expect(paraCentavos(texto)).toBe(esperado));
  it.each(['', 'abc', '10,555', '10.5555', '-5', '100.000.000,00', '1,2,3'])('recusa %s', (texto) =>
    expect(paraCentavos(texto)).toBeNull(),
  );
});

describe('Preço do paciente (FIN-09)', () => {
  it('GET 404: formulário de criação sem row_version, valor em centavos', async () => {
    const f = setup('/app/financeiro/preco/paciente/p1', [naoEncontrado()], [json(preco(15050))]);
    expect(await screen.findByText('Sem valor definido.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Valor padrão da sessão/), '150,50');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Valor atual: R\$\s150,50/)).toBeTruthy();
    expect(puts(f)).toEqual([{ url: '/api/pacientes/p1/preco', corpo: { valor: 15050 } }]);
  });

  it('GET 200: mostra em reais e edita com o row_version lido', async () => {
    const f = setup(
      '/app/financeiro/preco/paciente/p1',
      [json(preco(12000, 3))],
      [json(preco(13000, 4))],
    );
    expect(await screen.findByText(/Valor atual: R\$\s120,00/)).toBeTruthy();
    const campo = screen.getByLabelText(/Valor padrão da sessão/) as HTMLInputElement;
    expect(campo.value).toBe('120,00');
    await userEvent.clear(campo);
    await userEvent.type(campo, '130');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Valor atual: R\$\s130,00/)).toBeTruthy();
    expect(puts(f)[0]?.corpo).toEqual({ valor: 13000, row_version: 3 });
  });

  it('recusa decimal com mais de 2 casas e valor acima do teto, sem chamar a API', async () => {
    const f = setup('/app/financeiro/preco/paciente/p1', [naoEncontrado()]);
    const campo = await screen.findByLabelText(/Valor padrão da sessão/);
    await userEvent.type(campo, '10,555');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText(/Informe um valor entre R\$ 0,00/)).toBeTruthy();
    await userEvent.clear(campo);
    await userEvent.type(campo, '100.000.000,00');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText(/Informe um valor entre R\$ 0,00/)).toBeTruthy();
    expect(puts(f)).toHaveLength(0);
  });

  it('409 versao_divergente pede para recarregar e mantém o que foi digitado', async () => {
    const f = setup(
      '/app/financeiro/preco/paciente/p1',
      [json(preco(12000, 3)), json(preco(20000, 4))],
      [json({ codigo: 'versao_divergente' }, 409), json(preco(13000, 5))],
    );
    const campo = (await screen.findByLabelText(/Valor padrão da sessão/)) as HTMLInputElement;
    await userEvent.clear(campo);
    await userEvent.type(campo, '130');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/foi alterado em outra sessão/)).toBeTruthy();
    expect(await screen.findByText(/Valor atual: R\$\s200,00/)).toBeTruthy();
    expect((screen.getByLabelText(/Valor padrão da sessão/) as HTMLInputElement).value).toBe('130');
    // Revisa e salva de novo: agora com a versão recarregada.
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(puts(f)).toHaveLength(2));
    expect(puts(f)[1]?.corpo).toEqual({ valor: 13000, row_version: 4 });
  });

  it('erro de carregamento mostra alerta; sem violações de acessibilidade', async () => {
    setup('/app/financeiro/preco/paciente/p1', [json({ codigo: 'erro_interno' }, 500)]);
    expect(await screen.findByText(/Não foi possível carregar o valor/)).toBeTruthy();
    cleanup();
    setup('/app/financeiro/preco/paciente/p1', [json(preco(100))]);
    await screen.findByText(/Valor atual/);
    expect((await axe(document.body)).violations).toHaveLength(0);
  });
});

describe('Preço da sessão (FIN-09)', () => {
  it('usa /api/sessoes/:id/preco e o texto de ajuste', async () => {
    const f = setup(
      '/app/financeiro/preco/sessao/s9',
      [naoEncontrado()],
      [json({ sessao_id: 's9', valor: 8000, row_version: 1, criado_em: 'x' })],
    );
    expect(await screen.findByText('Esta sessão usa o valor padrão do paciente.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Ajuste desta sessão/), '80');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Valor atual: R\$\s80,00/)).toBeTruthy();
    expect(puts(f)).toEqual([{ url: '/api/sessoes/s9/preco', corpo: { valor: 8000 } }]);
  });
});
