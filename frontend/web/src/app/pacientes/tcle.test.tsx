import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { ConsentsCard } from './tcle.tsx';

// T73 / PAC-05: registro de TCLE na ficha. Casos de patients/ficha/ConsentsCard.spec.tsx do
// legado, sem a ciência de IA (fora do escopo), para /api/pacientes/:id/tcle: lista do mais
// recente, formulário recolhido, campos obrigatórios com os limites do contrato, sucesso
// anunciado, falha com os dados mantidos e nenhum botão de editar ou excluir.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  definirCsrf(null);
  delete document.documentElement.dataset['theme'];
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function mock(o: { postStatus?: number; iniciais?: unknown[] } = {}) {
  const itens: unknown[] = [...(o.iniciais ?? [])];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/eu') return json({ perfil: { completo: true }, csrf_token: 't' });
    if (url.endsWith('/tcle')) {
      if (init?.method === 'POST') {
        if (o.postStatus) return json({ codigo: 'erro' }, o.postStatus);
        const corpo = JSON.parse(String(init.body)) as Record<string, string>;
        itens.unshift({ id: `c${itens.length + 1}`, ...corpo, registrado_em: 'x' });
        return json(itens[0], 201);
      }
      return json({ items: itens });
    }
    throw new Error(`sem mock: ${url}`);
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ConsentsCard id="p1" />
    </QueryClientProvider>,
  );
const comMetodo = (f: ReturnType<typeof vi.fn>, metodo: string) =>
  f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === metodo);
const alternador = () => screen.findByRole('button', { name: 'Registrar novo TCLE' });

describe('Consentimentos: TCLE (PAC-05)', () => {
  it('lista os TCLEs com data, versão e finalidade', async () => {
    mock({
      iniciais: [
        {
          id: 'c2',
          finalidade: 'Atendimento',
          data: '2026-06-10',
          versao: 'v2',
          registrado_em: 'x',
        },
        { id: 'c1', finalidade: 'Avaliação', data: '2026-01-05', versao: 'v1', registrado_em: 'x' },
      ],
    });
    setup();
    const itens = await screen.findAllByRole('listitem');
    expect(itens.map((i) => i.textContent)).toEqual([
      '10/06/2026 · versão v2 · Atendimento',
      '05/01/2026 · versão v1 · Avaliação',
    ]);
  });

  it('inicia recolhido: lista visível, formulário oculto, botão com aria-expanded/controls', async () => {
    mock();
    setup();
    expect(await screen.findByText('Nenhum TCLE registrado.')).toBeTruthy();
    const b = await alternador();
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(b.getAttribute('aria-controls')!)!.hidden).toBe(true);
    expect(
      screen.getByText('Registros de TCLE não podem ser editados nem excluídos.'),
    ).toBeTruthy();
  });

  it('abrir mostra o formulário com a orientação, os limites e foca Finalidade', async () => {
    mock();
    setup();
    const b = await alternador();
    await userEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Não coloque conteúdo clínico/)).toBeTruthy();
    const finalidade = screen.getByLabelText(/Finalidade/);
    expect(document.activeElement).toBe(finalidade);
    expect(finalidade.getAttribute('maxLength')).toBe('500');
    expect(screen.getByLabelText(/Versão do termo/).getAttribute('maxLength')).toBe('50');
    expect(screen.getByLabelText(/Data do consentimento/).getAttribute('type')).toBe('date');
    expect(screen.queryByRole('button', { name: /exclu|edit/i })).toBeNull();
  });

  it('sucesso: POST, recolhe, anuncia em role=status, lista e devolve foco ao botão', async () => {
    const f = mock();
    setup();
    const b = await alternador();
    await userEvent.click(b);
    await userEvent.type(screen.getByLabelText(/Finalidade/), ' Atendimento psicológico ');
    const data = screen.getByLabelText(/Data do consentimento/);
    await userEvent.clear(data);
    await userEvent.type(data, '2026-10-01');
    await userEvent.type(screen.getByLabelText(/Versão do termo/), 'v1');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar TCLE' }));
    expect(
      await screen.findByText('01/10/2026 · versão v1 · Atendimento psicológico'),
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('TCLE registrado.');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(b);
    const [post] = comMetodo(f, 'POST');
    expect(String(post![0])).toBe('/api/pacientes/p1/tcle');
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
      finalidade: 'Atendimento psicológico',
      data: '2026-10-01',
      versao: 'v1',
    });
  });

  it('valida campos obrigatórios sem chamar POST', async () => {
    const f = mock();
    setup();
    await userEvent.click(await alternador());
    await userEvent.click(screen.getByRole('button', { name: 'Registrar TCLE' }));
    expect(await screen.findByText(/Preencha finalidade/)).toBeTruthy();
    expect(comMetodo(f, 'POST')).toHaveLength(0);
  });

  it('falha mantém aberto com os dados e mostra o alerta', async () => {
    mock({ postStatus: 500 });
    setup();
    const b = await alternador();
    await userEvent.click(b);
    await userEvent.type(screen.getByLabelText(/Finalidade/), 'Atendimento');
    await userEvent.type(screen.getByLabelText(/Versão do termo/), 'v1');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar TCLE' }));
    expect(await screen.findByText(/Não foi possível registrar o TCLE/)).toBeTruthy();
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByLabelText(/Finalidade/) as HTMLInputElement).value).toBe('Atendimento');
  });

  it('recolher sem enviar preserva o digitado', async () => {
    const f = mock();
    setup();
    const b = await alternador();
    await userEvent.click(b);
    await userEvent.type(screen.getByLabelText(/Finalidade/), 'Rascunho');
    await userEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(b);
    expect((screen.getByLabelText(/Finalidade/) as HTMLInputElement).value).toBe('Rascunho');
    expect(comMetodo(f, 'POST')).toHaveLength(0);
  });

  it('sem a seção de ciência de IA', async () => {
    mock();
    setup();
    await screen.findByText('Nenhum TCLE registrado.');
    expect(screen.queryByRole('button', { name: /ciência de IA/ })).toBeNull();
    expect(screen.queryByText('Uso de IA')).toBeNull();
  });

  it.each(['light', 'dark'] as const)(
    'sem violações axe, recolhido e aberto (tema %s)',
    async (t) => {
      document.documentElement.dataset['theme'] = t;
      mock();
      const { container } = setup();
      await screen.findByText('Nenhum TCLE registrado.');
      expect((await axe(container)).violations).toEqual([]);
      await userEvent.click(await alternador());
      expect((await axe(container)).violations).toEqual([]);
    },
  );
});
