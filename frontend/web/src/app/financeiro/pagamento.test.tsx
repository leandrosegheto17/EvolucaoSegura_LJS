import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { PagamentoPage, hojeSaoPaulo } from './pagamento.tsx';

// T167 / FIN-09: tela /app/financeiro/pagamento/:sessaoId. Casos de billing/payment/PaymentPage.spec
// do legado, para PUT /api/sessoes/:id/pagamento (201 cria, 200 corrige; códigos 422 em maiúsculas).

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
const pagamento = (extra: Record<string, unknown> = {}) => ({
  id: 'x',
  sessao_id: 's1',
  valor: 15000,
  data: '2026-10-26',
  meio: 'cartao',
  row_version: 1,
  criado_em: '2026-10-26T10:00:00.000Z',
  ...extra,
});

function setup(puts: Response[]) {
  const f = vi.fn<(u: string, init?: RequestInit) => Promise<Response>>(async (u, init) => {
    if (u === '/api/eu') return json({ csrf_token: 't' });
    return init?.method === 'PUT' ? (puts.shift() ?? json({}, 500)) : json({}, 404);
  });
  vi.stubGlobal('fetch', f);
  render(
    <MemoryRouter initialEntries={['/app/financeiro/pagamento/s1']}>
      <main>
        <Routes>
          <Route path="/app/financeiro/pagamento/:sessaoId" element={<PagamentoPage />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
  return f;
}
const envios = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
    .map((c) => ({ url: String(c[0]), corpo: JSON.parse(String((c[1] as RequestInit).body)) }));
const escolherMeio = async (rotulo = 'Cartão') =>
  userEvent.selectOptions(await screen.findByLabelText(/Meio de pagamento/), rotulo);
const enviar = () => userEvent.click(screen.getByRole('button', { name: 'Marcar como pago' }));

describe('Pagamento da sessão (FIN-09)', () => {
  it('data padrão é hoje em America/Sao_Paulo e o meio vem da lista fechada', async () => {
    setup([]);
    const data = (await screen.findByLabelText(/Data do pagamento/)) as HTMLInputElement;
    expect(data.value).toBe(hojeSaoPaulo());
    expect(hojeSaoPaulo()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const opcoes = Array.from(
      (screen.getByLabelText(/Meio de pagamento/) as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    expect(opcoes).toEqual(['Selecione', 'Dinheiro', 'Pix', 'Cartão', 'Transferência', 'Outro']);
  });

  it('hojeSaoPaulo usa o fuso de São Paulo, não o do aparelho', () => {
    // 2026-10-27 01:30 UTC ainda é dia 26 em São Paulo (UTC-3).
    expect(hojeSaoPaulo(new Date('2026-10-27T01:30:00Z'))).toBe('2026-10-26');
  });

  it('meio e data são obrigatórios e nada é enviado sem eles', async () => {
    const f = setup([]);
    await userEvent.clear(await screen.findByLabelText(/Data do pagamento/));
    await enviar();
    expect(screen.getByText('Informe a data.')).toBeTruthy();
    expect(screen.getByText('Informe o meio de pagamento.')).toBeTruthy();
    expect(envios(f)).toHaveLength(0);
  });

  it('valor vazio não vai no corpo (a API usa o preço); 201 diz "marcada como paga"', async () => {
    const f = setup([json(pagamento(), 201)]);
    await escolherMeio();
    await enviar();
    expect(await screen.findByText('Sessão marcada como paga')).toBeTruthy();
    expect(screen.getByText(/R\$\s150,00/)).toBeTruthy();
    expect(envios(f)).toEqual([
      {
        url: '/api/sessoes/s1/pagamento',
        corpo: { data: hojeSaoPaulo(), meio: 'cartao' },
      },
    ]);
  });

  it('valor digitado em reais vai em centavos; decimal inválido é recusado', async () => {
    const f = setup([json(pagamento({ valor: 12050 }), 201)]);
    await escolherMeio('Pix');
    const valor = screen.getByLabelText(/Valor/);
    await userEvent.type(valor, '10,555');
    await enviar();
    expect(screen.getByText(/até 2 casas decimais/)).toBeTruthy();
    expect(envios(f)).toHaveLength(0);
    await userEvent.clear(valor);
    await userEvent.type(valor, '120,50');
    await enviar();
    await screen.findByText('Sessão marcada como paga');
    expect(envios(f)[0]?.corpo).toMatchObject({ meio: 'pix', valor: 12050 });
  });

  it('422 PRICE_REQUIRED pede o valor e o reenvio leva o valor', async () => {
    const f = setup([
      json({ codigo: 'PRICE_REQUIRED' }, 422),
      json(pagamento({ valor: 9000 }), 201),
    ]);
    await escolherMeio('Dinheiro');
    await enviar();
    expect(await screen.findByText(/não há preço definido/i)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Valor/), '90');
    await enviar();
    await screen.findByText('Sessão marcada como paga');
    expect(envios(f)[1]?.corpo).toMatchObject({ meio: 'dinheiro', valor: 9000 });
  });

  it('422 PAYMENT_DUPLICATE pede confirmação e só então reenvia com confirmar_duplicidade', async () => {
    const f = setup([
      json({ codigo: 'PAYMENT_DUPLICATE' }, 422),
      json(pagamento({ row_version: 2 }), 200),
    ]);
    await escolherMeio();
    await enviar();
    expect(await screen.findByText(/já tem pagamento registrado/)).toBeTruthy();
    expect(envios(f)).toHaveLength(1);
    expect(envios(f)[0]?.corpo).not.toHaveProperty('confirmar_duplicidade');
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir lançamento' }));
    await waitFor(() => expect(envios(f)).toHaveLength(2));
    expect(envios(f)[1]?.corpo).toMatchObject({ confirmar_duplicidade: true, meio: 'cartao' });
    expect(await screen.findByText('Pagamento corrigido')).toBeTruthy();
    expect(screen.queryByText('Sessão marcada como paga')).toBeNull();
  });

  it('cancelar a confirmação não reenvia', async () => {
    const f = setup([json({ codigo: 'PAYMENT_DUPLICATE' }, 422)]);
    await escolherMeio();
    await enviar();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText(/já tem pagamento registrado/)).toBeNull();
    expect(envios(f)).toHaveLength(1);
  });

  it('404 e erro genérico mostram alerta; sem violações axe', async () => {
    setup([json({ codigo: 'nao_encontrado' }, 404)]);
    await escolherMeio();
    await enviar();
    expect(await screen.findByText(/Sessão não encontrada/)).toBeTruthy();
    cleanup();
    setup([json({ codigo: 'erro_interno' }, 500)]);
    await escolherMeio();
    await enviar();
    expect(await screen.findByText(/Não foi possível salvar o pagamento/)).toBeTruthy();
    expect((await axe(document.body)).violations).toEqual([]);
  });
});
