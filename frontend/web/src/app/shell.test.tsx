import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Shell } from './shell.tsx';
import { setTheme } from './theme.ts';

// T65 / PUB-02, PERF-01: shell do app sob /app e guarda de perfil.
// - Navegação igual à do legado: casos de app/shell/Shell.spec.tsx do legado, com os caminhos
//   sob /app (trilho de 104 px, barra de 5 itens, Configurações no rodapé e no cabeçalho, menu da
//   conta, skip link).
// - PERF-01: enquanto o perfil não tem nome e especialidade (perfil.completo de GET /api/eu),
//   qualquer rota de /app vai para /app/perfil; com o perfil completo, a rota pedida fica.

vi.mock('./sair.ts', () => ({ useSignOut: () => vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe('navegação do legado (PUB-02)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ nome: 'Maria da Silva' }), { status: 200 }),
        ),
    );
    localStorage.clear();
    setTheme('system');
    document.documentElement.removeAttribute('data-theme');
  });

  function renderAt(path: string) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/app" element={<h1>Inicio</h1>} />
              <Route path="/app/agenda" element={<h1>Agenda</h1>} />
              <Route path="/app/configuracoes" element={<h1>Config</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const acct = () => screen.getByRole('button', { name: /^Conta/ });
  const nav = () => screen.getByRole('navigation', { name: 'Principal' });

  describe('cabeçalho com AccountMenu (RF-51c/f, RF-52a)', () => {
    it.each(['/app', '/app/agenda'])(
      'exibe o botão de conta em %s e nenhum botão/opção de tema no topo',
      (path) => {
        renderAt(path);
        expect(acct()).toBeVisible();
        expect(screen.queryByRole('button', { name: /Tema:/ })).toBeNull();
        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByText(/^(Claro|Escuro|Sistema)$/)).toBeNull();
      },
    );

    it('cabeçalho é banner sticky 56px (mobile) e topbar (PC), acima do main', () => {
      renderAt('/app');
      const header = screen.getByRole('banner');
      expect(header).toContainElement(acct());
      expect(header.className).toMatch(/sticky/);
      expect(header.className).toMatch(/h-14/);
      expect(header.className).toMatch(/min-\[861px\]:ml-\[104px\]/);
      expect(header.className).toMatch(/justify-end/);
      const main = screen.getByRole('main');
      expect(main.classList).toContain('min-[861px]:ml-[104px]');
      expect(main.classList).toContain('outline-none');
      expect(header.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('skip link continua primeiro foco e main segue focável', async () => {
      const user = userEvent.setup();
      renderAt('/app');
      await user.tab();
      expect(screen.getByRole('link', { name: /conte/i })).toHaveFocus();
      expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
    });

    it('alternar Modo escuro no menu da conta aplica o tema e persiste (reabrir aplica)', async () => {
      const user = userEvent.setup();
      const { unmount } = renderAt('/app');
      await user.click(acct());
      await user.click(screen.getByRole('switch', { name: 'Modo escuro' }));
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.length).toBeGreaterThan(0);
      unmount();
      renderAt('/app/agenda');
      await user.click(acct());
      expect(screen.getByRole('switch', { name: 'Modo escuro' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('sem violações axe', async () => {
      const { container } = renderAt('/app');
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('entrada Configurações (RF-49s/t)', () => {
    it.each(['/app', '/app/agenda'])(
      'rodapé do trilho e cabeçalho levam a /app/configuracoes em %s',
      (path) => {
        renderAt(path);
        const links = screen.getAllByRole('link', { name: 'Configurações' });
        expect(links).toHaveLength(2);
        links.forEach((l) => expect(l).toHaveAttribute('href', '/app/configuracoes'));
        const rail = links.find((l) => nav().contains(l))!;
        const head = links.find((l) => screen.getByRole('banner').contains(l))!;
        expect(rail.parentElement!.className).toMatch(/mt-auto/);
        expect(head.className).toMatch(/min-h-11/);
        expect(
          head.compareDocumentPosition(acct()) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(nav().querySelectorAll(':scope > a')).toHaveLength(4);
        expect(rail.className).toMatch(/hidden/);
      },
    );

    it('breakpoints complementares (860 px não duplica Configurações)', () => {
      renderAt('/app');
      const wrapper = nav().querySelector(':scope > div')!;
      expect(wrapper.className).not.toContain('max-[');
      expect(wrapper.classList).toContain('contents');
      expect(wrapper.classList).toContain('min-[861px]:flex');
      const head = screen
        .getAllByRole('link', { name: 'Configurações' })
        .find((l) => screen.getByRole('banner').contains(l))!;
      expect(head.classList).toContain('min-[861px]:hidden');
      expect(head.className).not.toContain('max-[');
    });

    it('aria-current na rota ativa e Enter navega', async () => {
      const user = userEvent.setup();
      renderAt('/app/agenda');
      const rail = screen.getAllByRole('link', { name: 'Configurações' })[0]!;
      expect(rail).not.toHaveAttribute('aria-current');
      rail.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('heading', { name: 'Config' })).toBeVisible();
      screen
        .getAllByRole('link', { name: 'Configurações' })
        .forEach((l) => expect(l).toHaveAttribute('aria-current', 'page'));
    });
  });

  describe('trilho de 104 px e barra de 5 itens (RF-51a/b/f)', () => {
    it('PC: 6 links na ordem, sob /app, Perfil fora, ícones aria-hidden', () => {
      renderAt('/app');
      const links = within(nav()).getAllByRole('link');
      expect(links.map((l) => l.textContent)).toEqual([
        'Início',
        'Agenda',
        'Pacientes',
        'Financeiro',
        'Auditoria',
        'Configurações',
      ]);
      expect(links.map((l) => l.getAttribute('href'))).toEqual([
        '/app',
        '/app/agenda',
        '/app/pacientes',
        '/app/financeiro',
        '/app/auditoria',
        '/app/configuracoes',
      ]);
      expect(screen.queryByRole('link', { name: 'Perfil' })).toBeNull();
      const svgs = nav().querySelectorAll('svg');
      expect(svgs).toHaveLength(6);
      svgs.forEach((s) => expect(s).toHaveAttribute('aria-hidden', 'true'));
      expect(nav().className).toContain('min-[861px]:w-[104px]');
    });

    it('rodapé separado por linha e empurrado para baixo', () => {
      renderAt('/app');
      const footer = screen.getByRole('link', { name: 'Auditoria' }).parentElement!;
      expect(footer.className).toMatch(/mt-auto/);
      expect(footer.className).toMatch(/border-t/);
      expect(
        within(footer)
          .getAllByRole('link')
          .map((l) => l.textContent),
      ).toEqual(['Auditoria', 'Configurações']);
    });

    it('barra inferior: exatamente 5 itens visíveis (Configurações só no trilho de PC)', () => {
      renderAt('/app');
      const visible = within(nav())
        .getAllByRole('link')
        .filter((l) => !l.classList.contains('hidden'));
      expect(visible.map((l) => l.textContent)).toEqual([
        'Início',
        'Agenda',
        'Pacientes',
        'Financeiro',
        'Auditoria',
      ]);
    });

    it('ativo: aria-current, barra de 3 px e rótulo sem nowrap com overflow-wrap:anywhere', () => {
      renderAt('/app/agenda');
      const active = within(nav()).getByRole('link', { name: 'Agenda' });
      expect(active).toHaveAttribute('aria-current', 'page');
      expect(active.className).toContain('aria-[current=page]:before:block');
      expect(active.className).toContain('before:w-[3px]');
      expect(active.className).not.toMatch(/nowrap/);
      expect(active.className).toContain('[overflow-wrap:anywhere]');
      expect(
        within(nav())
          .getAllByRole('link')
          .filter((l) => l.hasAttribute('aria-current')),
      ).toHaveLength(1);
    });

    it('Início fica ativo só em /app, não nas rotas de baixo', () => {
      renderAt('/app/agenda');
      expect(within(nav()).getByRole('link', { name: 'Início' })).not.toHaveAttribute(
        'aria-current',
      );
    });
  });
});

describe('guarda de perfil (PERF-01)', () => {
  // GET /api/eu responde o estado do perfil; GET /api/perfil, o nome do menu da conta.
  function simularApi(completo: boolean) {
    const f = vi.fn(async (url: string) => {
      const corpo = url === '/api/eu' ? { perfil: { completo }, csrf_token: 't' } : { nome: 'Ana' };
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', f);
    return f;
  }

  // As rotas reais do app; módulo novo a cada teste para o cache do TanStack Query começar vazio.
  async function abrir(caminho: string) {
    vi.resetModules();
    const { rotas } = await import('../rotas.tsx');
    const roteador = createMemoryRouter(rotas, { initialEntries: [caminho] });
    render(<RouterProvider router={roteador} />);
    return roteador;
  }

  it.each(['/app', '/app/agenda', '/app/configuracoes', '/app/qualquer/coisa'])(
    'perfil incompleto: %s vai para /app/perfil',
    async (caminho) => {
      const f = simularApi(false);

      const roteador = await abrir(caminho);

      await vi.waitFor(() => expect(roteador.state.location.pathname).toBe('/app/perfil'));
      expect(f.mock.calls.map((c) => c[0])).toContain('/api/eu');
      expect(await screen.findByRole('heading', { name: 'Perfil' })).toBeTruthy();
    },
  );

  it('perfil incompleto: /app/perfil fica onde está', async () => {
    const f = simularApi(false);

    const roteador = await abrir('/app/perfil');

    await vi.waitFor(() => expect(f.mock.calls.map((c) => c[0])).toContain('/api/eu'));
    await new Promise((r) => setTimeout(r, 20));
    expect(roteador.state.location.pathname).toBe('/app/perfil');
  });

  it('perfil completo: a rota pedida fica', async () => {
    const f = simularApi(true);

    const roteador = await abrir('/app');

    await vi.waitFor(() => expect(f.mock.calls.map((c) => c[0])).toContain('/api/eu'));
    await new Promise((r) => setTimeout(r, 20));
    expect(roteador.state.location.pathname).toBe('/app');
    expect(screen.getByRole('heading', { level: 1, name: 'Evolução Segura' })).toBeTruthy();
  });

  it('as páginas públicas não passam pela guarda', async () => {
    const f = simularApi(false);

    const roteador = await abrir('/entrar');

    await new Promise((r) => setTimeout(r, 20));
    expect(roteador.state.location.pathname).toBe('/entrar');
    expect(f.mock.calls.map((c) => c[0])).not.toContain('/api/eu');
  });
});
