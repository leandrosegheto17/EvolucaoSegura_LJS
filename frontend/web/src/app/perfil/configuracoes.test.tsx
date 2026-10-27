import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { setTheme } from '../theme.ts';
import { SettingsPage } from './configuracoes.tsx';

// T66 / PERF-08: tela de Configurações. Casos de app/settings/SettingsPage.spec.tsx do legado,
// sem IA e sem inatividade (PERF-08: "sem opção de inatividade"). privacidade_agenda: desligada =
// nome completo na agenda, ligada = iniciais (comportamento do legado, T63).

vi.mock('../sair.ts', () => ({ useSignOut: () => vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  definirCsrf(null);
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const S = { privacidade_agenda: false };

function stub(over: Record<string, () => Response> = {}) {
  const calls: { key: string; body?: string }[] = [];
  const routes: Record<string, () => Response> = {
    'GET /api/configuracoes': () => json(S),
    'GET /api/eu': () => json({ perfil: { completo: true }, csrf_token: 't' }),
    'PUT /api/configuracoes': () => json({ privacidade_agenda: true }),
    ...over,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push({ key, body: init?.body as string });
      const h = routes[key];
      if (!h) throw new Error(`sem mock: ${key}`);
      return h();
    }),
  );
  return calls;
}
const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Configurações', () => {
  it('tem o cartão Notificações com o push do dispositivo (PERF-08, T179)', async () => {
    stub();
    setup();
    expect(await screen.findByRole('heading', { name: 'Notificações' })).toBeTruthy();
    // jsdom não tem service worker nem PushManager: o cartão explica e não chama a API.
    expect(screen.getByText(/Este navegador não recebe notificações/)).toBeTruthy();
  });

  it('privacidade desligada por padrão; sem inatividade e sem IA; acessível', async () => {
    stub();
    const { container } = setup();
    const sw = await screen.findByRole('switch', { name: /iniciais/ });
    expect((sw as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Agenda exibe o nome completo.')).toBeTruthy();
    expect(screen.queryByLabelText(/Encerrar a sessão após/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Inatividade' })).toBeNull();
    expect(screen.queryByRole('switch', { name: /Usar IA/ })).toBeNull();
    expect(container.textContent).not.toMatch(/inteligência artificial/i);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('alterna privacidade da agenda e envia boolean', async () => {
    const calls = stub();
    setup();
    const sw = await screen.findByRole('switch', { name: /iniciais/ });
    await userEvent.click(sw);
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PUT /api/configuracoes')?.body).toBe(
        '{"privacidade_agenda":true}',
      ),
    );
    await waitFor(() => expect((sw as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText('Agenda exibe iniciais.')).toBeTruthy();
    expect(await screen.findByText('Configuração salva.')).toBeTruthy();
  });

  it('erro ao salvar e erro ao carregar com retry', async () => {
    stub({ 'PUT /api/configuracoes': () => json({ titulo: 'x' }, 500) });
    setup();
    await userEvent.click(await screen.findByRole('switch', { name: /iniciais/ }));
    expect(await screen.findByText(/Não foi possível salvar/)).toBeTruthy();
    cleanup();
    stub({ 'GET /api/configuracoes': () => json({}, 500) });
    setup();
    expect(await screen.findByText(/Não foi possível carregar/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });
});

function mockDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: dark && q.includes('dark'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('Configurações: Aparência', () => {
  beforeEach(() => {
    act(() => setTheme('system'));
    localStorage.clear();
  });

  it('cartão com chave visível nos estados carregando e erro', async () => {
    stub({ 'GET /api/configuracoes': () => json({}, 500) });
    setup();
    expect(screen.getByRole('heading', { name: 'Aparência' })).toBeTruthy();
    expect(screen.getByText('Carregando configurações')).toBeTruthy();
    await screen.findByText(/Não foi possível carregar/);
    expect(screen.getByRole('switch', { name: 'Modo escuro' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Tema' })).toBeNull();
  });

  it('sem escolha salva: texto do aparelho e sem a ação', async () => {
    mockDark(true);
    stub();
    setup();
    expect(await screen.findByText('Seguindo o tema do aparelho (agora: escuro).')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seguir o tema do aparelho' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Modo escuro' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it.each([
    ['light', 'claro'],
    ['dark', 'escuro'],
  ] as const)('escolha salva %s mostra texto e ação', async (v, txt) => {
    mockDark(false);
    act(() => setTheme(v));
    stub();
    setup();
    expect(await screen.findByText(`Você escolheu o tema ${txt}.`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seguir o tema do aparelho' })).toBeTruthy();
  });

  it('chave sincroniza com setTheme externo; ação grava system, some, foca a chave e anuncia', async () => {
    mockDark(false);
    stub();
    setup();
    const sw = await screen.findByRole('switch', { name: 'Modo escuro' });
    await userEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('theme-preference')).toBe('dark');
    act(() => setTheme('light'));
    expect(sw.getAttribute('aria-checked')).toBe('false');
    act(() => setTheme('dark'));
    await userEvent.click(screen.getByRole('button', { name: 'Seguir o tema do aparelho' }));
    expect(localStorage.getItem('theme-preference')).toBe('system');
    expect(screen.queryByRole('button', { name: 'Seguir o tema do aparelho' })).toBeNull();
    expect(document.activeElement).toBe(sw);
    expect(
      screen.getByText('O tema agora segue o aparelho.').closest('[role="status"]'),
    ).toBeTruthy();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(Object.keys(localStorage)).toEqual(['theme-preference']);
  });

  it('Encerrar sessão permanece e o cartão passa no axe', async () => {
    stub();
    const { container } = setup();
    expect(await screen.findByRole('button', { name: 'Encerrar sessão' })).toBeTruthy();
    expect((await axe(container)).violations).toEqual([]);
  });
});
