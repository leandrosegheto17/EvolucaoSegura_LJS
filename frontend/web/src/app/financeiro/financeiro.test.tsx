import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { FinanceiroPage } from './financeiro.tsx';

// T116 / FIN-07: tela /app/financeiro. Casos de billing/debts/DebtsPage.spec.tsx do legado, para
// /api/debitos: filtro (todos, em débito, em dia) guardado na URL, total pendente em reais a
// partir de centavos (ADR-007) e detalhe das sessões pendentes do paciente.

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
const cliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const ana = {
  paciente_id: 'p1',
  nome: 'Ana Souza',
  status: 'em_debito',
  sessoes_pendentes: 2,
  valor_pendente: 123456,
};
const bia = {
  paciente_id: 'p2',
  nome: 'Bia Lima',
  status: 'em_dia',
  sessoes_pendentes: 0,
  valor_pendente: 0,
};
const pendenciasAna = {
  paciente_id: 'p1',
  nome: 'Ana Souza',
  sessoes: [
    { sessao_id: 's1', inicio: '2026-10-20T13:00:00.000Z', status: 'realizada', valor: 10000 },
    { sessao_id: 's2', inicio: '2026-10-21T13:00:00.000Z', status: 'faltou', valor: null },
  ],
  total_sessoes: 2,
  valor_pendente: 10000,
};

function mock(opcoes: { itens?: unknown[]; total?: number; erro?: boolean } = {}) {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (opcoes.erro) return json({ codigo: 'erro_interno' }, 500);
    if (url.startsWith('/api/debitos/')) return json(pendenciasAna);
    return json({ items: opcoes.itens ?? [ana, bia], total_pendente: opcoes.total ?? 123456 });
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

function Onde() {
  const l = useLocation();
  return <output data-testid="loc">{l.pathname + l.search}</output>;
}
const setup = (url = '/app/financeiro') =>
  render(
    <QueryClientProvider client={cliente()}>
      <MemoryRouter initialEntries={[url]}>
        <FinanceiroPage />
        <Onde />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Financeiro: débitos e total (FIN-07)', () => {
  it('lista todos por padrão, sem status na consulta, com situação e sessões pendentes', async () => {
    const f = mock();
    setup();
    await screen.findByText('Ana Souza');
    expect(urls(f)).toContain('/api/debitos');
    const linha = screen.getByText('Ana Souza').closest('tr')!;
    expect(within(linha).getByText('Em débito')).toBeTruthy();
    expect(within(linha).getByText('2')).toBeTruthy();
    const outra = screen.getByText('Bia Lima').closest('tr')!;
    expect(within(outra).getByText('Em dia')).toBeTruthy();
  });

  it('mostra o total pendente em reais a partir de centavos', async () => {
    mock({ total: 123456 });
    setup();
    await screen.findByText('Ana Souza');
    const total = screen.getByTestId('total-pendente');
    expect(total.textContent).toMatch(/R\$\s*1\.234,56/);
    const linha = screen.getByText('Ana Souza').closest('tr')!;
    expect(linha.textContent).toMatch(/R\$\s*1\.234,56/);
  });

  it('lê o filtro da URL e consulta ?status=em_debito', async () => {
    const f = mock({ itens: [ana] });
    setup('/app/financeiro?status=em_debito');
    await screen.findByText('Ana Souza');
    expect(urls(f)).toContain('/api/debitos?status=em_debito');
    expect((screen.getByLabelText('Situação financeira') as HTMLSelectElement).value).toBe(
      'em_debito',
    );
  });

  it('trocar o filtro grava na URL e consulta em_dia; voltar a todos limpa a URL', async () => {
    const f = mock();
    setup();
    await screen.findByText('Ana Souza');
    const select = screen.getByLabelText('Situação financeira');
    await userEvent.selectOptions(select, 'em_dia');
    expect(screen.getByTestId('loc').textContent).toBe('/app/financeiro?status=em_dia');
    await vi.waitFor(() => expect(urls(f)).toContain('/api/debitos?status=em_dia'));
    await userEvent.selectOptions(select, 'todos');
    expect(screen.getByTestId('loc').textContent).toBe('/app/financeiro');
  });

  it('valor de filtro desconhecido na URL cai em todos', async () => {
    const f = mock();
    setup('/app/financeiro?status=xyz');
    await screen.findByText('Ana Souza');
    expect(urls(f)).toContain('/api/debitos');
  });

  it('lista vazia mostra o estado vazio e total zerado', async () => {
    mock({ itens: [], total: 0 });
    setup();
    expect(await screen.findByText('Ninguém em débito')).toBeTruthy();
    expect(screen.getByTestId('total-pendente').textContent).toMatch(/R\$\s*0,00/);
  });

  it('falha da API mostra o erro sem dado financeiro', async () => {
    mock({ erro: true });
    setup();
    expect(await screen.findByText('Não foi possível carregar o financeiro.')).toBeTruthy();
  });
});

describe('Financeiro: sessões pendentes do paciente (FIN-07)', () => {
  it('"Ver pendências" guarda o paciente na URL e lista as sessões com valor em reais', async () => {
    const f = mock();
    setup();
    await screen.findByText('Ana Souza');
    await userEvent.click(screen.getByRole('button', { name: 'Ver pendências de Ana Souza' }));
    expect(screen.getByTestId('loc').textContent).toBe('/app/financeiro?paciente=p1');
    const secao = await screen.findByRole('region', { name: /Sessões pendentes/ });
    await within(secao).findByText('Realizada');
    expect(urls(f)).toContain('/api/debitos/p1');
    expect(within(secao).getByText(/R\$\s*100,00/, { selector: 'td' })).toBeTruthy();
    expect(within(secao).getByText('Sem preço')).toBeTruthy();
    expect(within(secao).getByText(/Total: 2 sessões/).textContent).toMatch(/R\$\s*100,00/);
  });

  it('abre o detalhe direto pela URL e "Fechar" tira o paciente da URL', async () => {
    mock();
    setup('/app/financeiro?status=em_debito&paciente=p1');
    const secao = await screen.findByRole('region', { name: /Sessões pendentes/ });
    await userEvent.click(within(secao).getByRole('button', { name: 'Fechar' }));
    expect(screen.getByTestId('loc').textContent).toBe('/app/financeiro?status=em_debito');
  });

  // T167 / FIN-09: link "Registrar pagamento" na lista de débitos.
  it('paciente em débito tem o link "Registrar pagamento" para as sessões pendentes; em dia não', async () => {
    mock();
    setup('/app/financeiro?status=em_debito');
    await screen.findByText('Ana Souza');
    const link = screen.getByRole('link', { name: 'Registrar pagamento de Ana Souza' });
    expect(link.getAttribute('href')).toBe('/app/financeiro?status=em_debito&paciente=p1');
    const outra = screen.getByText('Bia Lima').closest('tr')!;
    expect(within(outra).queryByRole('link', { name: /Registrar pagamento/ })).toBeNull();
  });

  it('cada sessão pendente tem o link "Registrar pagamento" para a tela do pagamento', async () => {
    mock();
    setup('/app/financeiro?paciente=p1');
    const secao = await screen.findByRole('region', { name: /Sessões pendentes/ });
    const links = await within(secao).findAllByRole('link', {
      name: /^Registrar pagamento da sessão/,
    });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/app/financeiro/pagamento/s1',
      '/app/financeiro/pagamento/s2',
    ]);
  });
});

describe('Financeiro: acessibilidade', () => {
  it('sem violações axe', async () => {
    mock();
    const { container } = setup('/app/financeiro?paciente=p1');
    await screen.findByText('Sem preço');
    expect((await axe(container)).violations).toEqual([]);
  });
});
