import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountMenu } from './AccountMenu';
import { setTheme } from '../theme';

const signOutSpy = vi.fn();
vi.mock('../sair.ts', () => ({ useSignOut: () => signOutSpy }));

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function setup(
  profile: { status: number; body: unknown } = { status: 200, body: { nome: 'Maria da Silva' } },
) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify(profile.body), { status: profile.status }),
      ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <>
      <button>outro</button>
      <AccountMenu />
      <button>depois</button>
      <Loc />
    </>,
    { wrapper: wrap },
  );
}

beforeEach(() => {
  signOutSpy.mockClear();
  localStorage.clear();
  setTheme('light');
});
afterEach(() => vi.unstubAllGlobals());

const trigger = () => screen.getByRole('button', { name: /^Conta/ });

describe('AccountMenu', () => {
  it('mobile: conteudo (#conteudo) fica inerte com o menu aberto e volta ao fechar', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    const main = document.createElement('main');
    main.id = 'conteudo';
    document.body.appendChild(main);
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Conta/ }));
    expect(main.inert).toBe(true);
    await user.keyboard('{Escape}');
    expect(main.inert).toBe(false);
    main.remove();
  });

  describe('inert de #conteudo', () => {
    let main: HTMLElement;
    const media = (matches: boolean) =>
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches,
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }));
    beforeEach(() => {
      main = document.createElement('main');
      main.id = 'conteudo';
      document.body.appendChild(main);
    });
    afterEach(() => main.remove());

    it('restaura apos clique fora', async () => {
      media(true);
      setup();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^Conta/ }));
      expect(main.inert).toBe(true);
      await user.click(document.body);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(main.inert).toBe(false);
    });

    it('restaura apos "Editar perfil"', async () => {
      media(true);
      setup();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^Conta/ }));
      expect(main.inert).toBe(true);
      await user.click(screen.getByRole('link', { name: 'Editar perfil' }));
      expect(main.inert).toBe(false);
    });

    it('restaura apos "Sair"', async () => {
      media(true);
      setup();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^Conta/ }));
      expect(main.inert).toBe(true);
      await user.click(screen.getByRole('button', { name: 'Sair' }));
      expect(main.inert).toBe(false);
    });

    it('restaura ao desmontar com o menu aberto', async () => {
      media(true);
      const { unmount } = setup();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^Conta/ }));
      expect(main.inert).toBe(true);
      unmount();
      expect(main.inert).toBe(false);
    });

    it('desktop (> 860 px): nao marca inert', async () => {
      media(false);
      setup();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^Conta/ }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(main.inert).toBeFalsy(); // jsdom: undefined se nunca atribuido
    });
  });

  it('nome acessível com nome; atributos ARIA; painel fechado', async () => {
    setup();
    await screen.findByRole('button', { name: 'Conta de Maria da Silva' });
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('erro do perfil: nome "Conta", sem mensagem', async () => {
    setup({ status: 500, body: {} });
    await waitFor(() => expect(screen.queryByText(/erro/i)).toBeNull());
    expect(screen.getByRole('button', { name: 'Conta' })).toBeInTheDocument();
  });

  it.each(['{Enter}', ' '])(
    '%j abre e foca "Editar perfil"; aria-controls aponta o painel',
    async (k) => {
      const user = userEvent.setup();
      setup();
      await screen.findByRole('button', { name: 'Conta de Maria da Silva' });
      trigger().focus();
      await user.keyboard(k);
      const dlg = screen.getByRole('dialog', { name: 'Conta' });
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(trigger().getAttribute('aria-controls')).toBe(dlg.id);
      expect(screen.getByRole('link', { name: 'Editar perfil' })).toHaveFocus();
      expect(screen.getByText('Maria da Silva')).toBeInTheDocument();
      expect(screen.queryByText(/seguir o tema/i)).toBeNull();
      expect(screen.queryByText(/@/)).toBeNull();
    },
  );

  it('setas, Home e End percorrem com volta', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(trigger());
    const link = screen.getByRole('link', { name: 'Editar perfil' });
    const plano = screen.getByRole('link', { name: 'Meu plano' });
    const sw = screen.getByRole('switch', { name: 'Modo escuro' });
    const sair = screen.getByRole('button', { name: 'Sair' });
    await user.keyboard('{ArrowDown}');
    expect(plano).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(sw).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(sair).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(link).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(sair).toHaveFocus();
    await user.keyboard('{Home}');
    expect(link).toHaveFocus();
    await user.keyboard('{End}');
    expect(sair).toHaveFocus();
  });

  it('Shift+Tab do primeiro fecha no botão; Tab do último fecha e segue', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(trigger());
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard('{End}{Tab}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'depois' })).toHaveFocus();
  });

  it('Esc fecha e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('clique fora fecha e devolve foco; em outro focável mantém o foco nele', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(trigger());
    await user.click(document.body);
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveFocus();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'outro' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'outro' })).toHaveFocus();
  });

  it('alternar a chave não fecha o painel e altera o tema', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(trigger());
    const sw = screen.getByRole('switch', { name: 'Modo escuro' });
    await user.click(sw);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveFocus();
  });

  it('"Editar perfil" navega para /app/perfil e fecha', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(trigger());
    await user.click(screen.getByRole('link', { name: 'Editar perfil' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/app/perfil');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"Meu plano" navega para /app/plano e fecha', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(trigger());
    await user.click(screen.getByRole('link', { name: 'Meu plano' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/app/plano');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"Sair" chama a rotina única (useSignOut) e fecha; tem texto e ícone', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(trigger());
    const sair = screen.getByRole('button', { name: 'Sair' });
    expect(sair.querySelector('svg')).not.toBeNull();
    await user.click(sair);
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['light', 'dark'] as const)(
    'axe sem serious/critical com painel aberto (%s)',
    async (t) => {
      setTheme(t);
      document.documentElement.dataset.theme = t;
      const user = userEvent.setup();
      const { container } = setup();
      await screen.findByRole('button', { name: 'Conta de Maria da Silva' });
      await user.click(trigger());
      const r = await axe(container);
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad).toEqual([]);
    },
  );
});
