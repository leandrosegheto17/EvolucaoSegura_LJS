import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { definirCsrf } from '../../lib/api.ts';
import { MeuPlanoPage } from './meu-plano.tsx';

// T135 / PLANO-05, PLANO-11, PLANO-14: tela /app/plano.

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
const PIX = {
  valor_centavos: 4990,
  vencimento: '2026-11-05',
  copia_e_cola: '00020126PIXCOPIA',
  qr_code_png_base64: 'QUJD',
  expira_em: '2026-11-05 23:59:59',
};
const plano = (extra: object = {}) => ({
  plano: 'free',
  status: 'free',
  data: null,
  pix: null,
  ...extra,
});
const indisponivel = () =>
  json(
    {
      tipo: 'about:blank',
      titulo: 'Cobrança indisponível',
      status: 503,
      codigo: 'cobranca_indisponivel',
    },
    503,
  );

function mock(rotas: Record<string, () => Response>) {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
    const chave = `${init?.method ?? 'GET'} ${url}`;
    if (chave === 'GET /api/eu') return json({ csrf_token: 'tok' });
    const r = rotas[chave];
    if (!r) throw new Error(`rota não simulada: ${chave}`);
    return r();
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const chamadas = (f: ReturnType<typeof vi.fn>, chave: string) =>
  f.mock.calls.filter(
    (c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${c[0]}` === chave,
  );

const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <MeuPlanoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Meu plano: situação (PLANO-14)', () => {
  it('ativa mostra Pro, renovação e o botão de cancelar, sem o formulário de assinar', async () => {
    mock({
      'GET /api/plano': () =>
        json(
          plano({
            plano: 'pro',
            status: 'ativa',
            data: { tipo: 'renovacao', em: '2026-12-10T12:00:00.000Z' },
          }),
        ),
    });
    setup();
    expect(await screen.findByText(/Renovação em 10\/12\/2026/)).toBeTruthy();
    expect(screen.getByText('Pro')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Assinar o Pro' })).toBeNull();
  });

  it('cancelada mostra o fim do Pro e nem assinar nem cancelar', async () => {
    mock({
      'GET /api/plano': () =>
        json(
          plano({
            plano: 'pro',
            status: 'cancelada',
            data: { tipo: 'fim', em: '2026-12-10T12:00:00.000Z' },
          }),
        ),
    });
    setup();
    expect(await screen.findByText(/O Pro vai até 10\/12\/2026/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Assinar o Pro' })).toBeNull();
  });

  it('cobrança pendente mostra valor em reais, vencimento, copia-e-cola e QR', async () => {
    mock({
      'GET /api/plano': () =>
        json(
          plano({
            plano: 'pro',
            status: 'atrasada',
            data: { tipo: 'fim', em: '2026-11-12T00:00:00.000Z' },
            pix: PIX,
          }),
        ),
    });
    setup();
    expect(await screen.findByText(/Valor: R\$\s49,90/)).toBeTruthy();
    expect(screen.getByText(/Vencimento: 05\/11\/2026/)).toBeTruthy();
    expect((screen.getByLabelText('Pix copia e cola') as HTMLInputElement).value).toBe(
      '00020126PIXCOPIA',
    );
    expect(screen.getByAltText('QR code do Pix').getAttribute('src')).toBe(
      'data:image/png;base64,QUJD',
    );
  });

  it('503 na leitura mostra "Cobrança indisponível"', async () => {
    mock({ 'GET /api/plano': indisponivel });
    setup();
    expect(await screen.findByText(/Cobrança indisponível/)).toBeTruthy();
  });
});

describe('Meu plano: assinar (PLANO-05)', () => {
  const preencher = async (doc: string) => {
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Nome completo'), 'Ana Souza');
    await u.type(screen.getByLabelText('CPF ou CNPJ'), doc);
    await u.click(screen.getByRole('button', { name: 'Assinar' }));
  };

  it('CPF com dígito inválido não chama a API e mostra o erro', async () => {
    const f = mock({ 'GET /api/plano': () => json(plano()) });
    setup();
    await preencher('529.982.247-24');
    expect(await screen.findByText('Informe um CPF ou CNPJ válido.')).toBeTruthy();
    expect(chamadas(f, 'POST /api/plano/assinar')).toHaveLength(0);
  });

  it('CPF válido com máscara envia só os dígitos e recarrega o plano', async () => {
    let assinou = false;
    const f = mock({
      'GET /api/plano': () =>
        json(assinou ? plano({ plano: 'pro', status: 'trial', pix: PIX }) : plano()),
      'POST /api/plano/assinar': () => {
        assinou = true;
        return json({ status: 'aguardando_pagamento' }, 201);
      },
    });
    setup();
    await preencher('529.982.247-25');
    expect(await screen.findByLabelText('Pix copia e cola')).toBeTruthy();
    const corpo = JSON.parse(
      String((chamadas(f, 'POST /api/plano/assinar')[0]![1] as RequestInit).body),
    );
    expect(corpo).toEqual({ nome: 'Ana Souza', cpf_cnpj: '52998224725' });
  });

  it('CNPJ válido é aceito', async () => {
    const f = mock({
      'GET /api/plano': () => json(plano()),
      'POST /api/plano/assinar': () => json({ status: 'aguardando_pagamento' }, 201),
    });
    setup();
    await preencher('11.222.333/0001-81');
    await waitFor(() => expect(chamadas(f, 'POST /api/plano/assinar')).toHaveLength(1));
  });

  it('503 ao assinar mostra "Cobrança indisponível"', async () => {
    mock({
      'GET /api/plano': () => json(plano()),
      'POST /api/plano/assinar': indisponivel,
    });
    setup();
    await preencher('529.982.247-25');
    expect(await screen.findByText(/Cobrança indisponível/)).toBeTruthy();
  });
});

describe('Meu plano: cancelar (PLANO-11)', () => {
  const ativa = () =>
    json(
      plano({
        plano: 'pro',
        status: 'ativa',
        data: { tipo: 'renovacao', em: '2026-12-10T12:00:00.000Z' },
      }),
    );

  it('pede confirmação e só cancela ao confirmar', async () => {
    let cancelada = false;
    const f = mock({
      'GET /api/plano': () =>
        cancelada
          ? json(
              plano({
                plano: 'pro',
                status: 'cancelada',
                data: { tipo: 'fim', em: '2026-12-10T12:00:00.000Z' },
              }),
            )
          : ativa(),
      'POST /api/plano/cancelar': () => {
        cancelada = true;
        return json({ status: 'cancelada', periodo_fim: '2026-12-10T12:00:00.000Z' });
      },
    });
    setup();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
    expect(await screen.findByText('Cancelar a assinatura?')).toBeTruthy();
    expect(chamadas(f, 'POST /api/plano/cancelar')).toHaveLength(0);
    const botoes = screen.getAllByRole('button', { name: 'Cancelar assinatura' });
    await u.click(botoes[botoes.length - 1]!);
    expect(await screen.findByText(/O Pro vai até 10\/12\/2026/)).toBeTruthy();
    expect(chamadas(f, 'POST /api/plano/cancelar')).toHaveLength(1);
  });

  it('"Manter assinatura" fecha sem cancelar', async () => {
    const f = mock({ 'GET /api/plano': ativa });
    setup();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
    await u.click(await screen.findByRole('button', { name: 'Manter assinatura' }));
    await waitFor(() => expect(screen.queryByText('Cancelar a assinatura?')).toBeNull());
    expect(chamadas(f, 'POST /api/plano/cancelar')).toHaveLength(0);
  });
});
