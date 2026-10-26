import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ThemeSwitch } from './ThemeSwitch';
import { setTheme } from '../theme';

type Listener = () => void;
let systemDark = false;
const listeners = new Set<Listener>();

beforeEach(() => {
  systemDark = false;
  listeners.clear();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return systemDark;
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }));
  localStorage.clear();
  setTheme('system');
});
afterEach(() => vi.unstubAllGlobals());

const sw = () => screen.getByRole('switch', { name: 'Modo escuro' });

// substitui: ThemeMenu.spec.tsx — persistência/aplicação do tema e Sistema
describe('ThemeSwitch', () => {
  it('sem escolha salva reflete o SO e acompanha o change', () => {
    render(<ThemeSwitch />);
    expect(sw()).toHaveAttribute('aria-checked', 'false');
    act(() => {
      systemDark = true;
      listeners.forEach((l) => l());
    });
    expect(sw()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Ligado')).toBeInTheDocument();
  });

  it.each([
    ['dark', 'true', 'Ligado'],
    ['light', 'false', 'Desligado'],
    ['system', 'false', 'Desligado'],
  ] as const)('valor pré-gravado %s', (v, checked, txt) => {
    setTheme(v);
    render(<ThemeSwitch />);
    expect(sw()).toHaveAttribute('aria-checked', checked);
    expect(screen.getByText(txt)).toBeInTheDocument();
  });

  it('alternar aplica, grava, mantém foco e o SO deixa de mandar; sem rede', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    render(<ThemeSwitch />);
    await user.click(sw());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme-preference')).toBe('dark');
    expect(sw()).toHaveFocus();
    expect(sw()).toHaveAttribute('aria-checked', 'true');
    act(() => {
      systemDark = false;
      listeners.forEach((l) => l());
    });
    expect(sw()).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Enter}');
    expect(localStorage.getItem('theme-preference')).toBe('light');
    expect(sw()).toHaveAttribute('aria-checked', 'false');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('alvo >= 44 px (min-h-11/min-w-11) e ícone decorativo', () => {
    render(<ThemeSwitch />);
    expect(sw().className).toMatch(/min-h-11/);
    expect(sw().className).toMatch(/min-w-11/);
    expect(sw().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(['light', 'dark'] as const)('axe sem violações (tema %s)', async (t) => {
    setTheme(t);
    const { container } = render(<ThemeSwitch />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
