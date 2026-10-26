import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { MemoryRouter, useLocation } from 'react-router';
import { MenuButton } from './MenuButton';

afterEach(() => document.documentElement.removeAttribute('data-theme'));

const items = [
  { label: 'Ficha', to: '/a' },
  { label: 'Evolução', to: '/b' },
  { label: 'Anamnese', to: '/c' },
];

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function setup() {
  return render(
    <MemoryRouter>
      <button>antes</button>
      <MenuButton label="Ações" items={items} />
      <button>depois</button>
      <Loc />
    </MemoryRouter>,
  );
}
const btn = () => screen.getByRole('button', { name: 'Ações' });

describe('MenuButton (APG menu button)', () => {
  it('fechado: atributos ARIA', () => {
    setup();
    expect(btn()).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn()).toHaveAttribute('aria-expanded', 'false');
    expect(btn()).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(['{Enter}', ' ', '{ArrowDown}'])('%s abre e foca o 1o item', async (k) => {
    const u = userEvent.setup();
    setup();
    btn().focus();
    await u.keyboard(k);
    expect(btn()).toHaveAttribute('aria-expanded', 'true');
    expect(btn().getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByRole('menuitem', { name: 'Ficha' })).toHaveFocus();
  });

  it('Seta acima abre no ultimo', async () => {
    const u = userEvent.setup();
    setup();
    btn().focus();
    await u.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Anamnese' })).toHaveFocus();
  });

  it('setas circulam, Home/End', async () => {
    const u = userEvent.setup();
    setup();
    btn().focus();
    await u.keyboard('{Enter}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Evolução' })).toHaveFocus();
    await u.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Ficha' })).toHaveFocus();
    await u.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Anamnese' })).toHaveFocus();
    await u.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'Ficha' })).toHaveFocus();
    await u.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Anamnese' })).toHaveFocus();
  });

  it('itens sao links; Enter segue e fecha', async () => {
    const u = userEvent.setup();
    setup();
    btn().focus();
    await u.keyboard('{Enter}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Evolução' })).toHaveAttribute('href', '/b');
    await u.keyboard('{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('/b');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Esc fecha devolvendo o foco', async () => {
    const u = userEvent.setup();
    setup();
    btn().focus();
    await u.keyboard('{Enter}{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(btn()).toHaveFocus();
  });

  it('Tab fecha e segue a ordem a partir do botao', async () => {
    const u = userEvent.setup();
    setup();
    btn().focus();
    await u.keyboard('{Enter}{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'depois' })).toHaveFocus();
  });

  it('Shift+Tab fecha e foca o botao', async () => {
    const u = userEvent.setup();
    setup();
    btn().focus();
    await u.keyboard('{Enter}{Shift>}{Tab}{/Shift}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(btn()).toHaveFocus();
  });

  it('clique fora fecha; em outro focavel nao rouba o foco', async () => {
    const u = userEvent.setup();
    setup();
    await u.click(btn());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'depois' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'depois' })).toHaveFocus();
  });

  it.each(['light', 'dark'])('axe sem violacoes (tema %s)', async (tema) => {
    document.documentElement.setAttribute('data-theme', tema);
    const u = userEvent.setup();
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
    await u.click(btn());
    expect(await axe(container)).toHaveNoViolations();
  });
});
