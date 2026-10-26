import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';
import { ShortcutTile } from './ShortcutTile';
import { ClockIcon } from './icons';

afterEach(() => document.documentElement.removeAttribute('data-theme'));

const ui = (sub?: string) => (
  <MemoryRouter><ShortcutTile to="/x" label="Histórico" icon={<ClockIcon />} subtitle={sub} /></MemoryRouter>
);

describe('ShortcutTile (RF-55c/d)', () => {
  it('um unico link com nome acessivel = rotulo exato, mesmo com subtitulo', () => {
    render(ui('Ver evolução'));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    const link = screen.getByRole('link', { name: 'Histórico' });
    expect(link).toHaveAttribute('href', '/x');
    expect(link).toHaveAccessibleDescription('Ver evolução');
  });

  it('icone aria-hidden, altura minima 72px, sem subtitulo sem descricao', () => {
    const { container } = render(ui());
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(screen.getByRole('link').className).toContain('min-h-[72px]');
    expect(screen.getByRole('link')).not.toHaveAttribute('aria-describedby');
  });

  for (const tema of ['light', 'dark']) {
    it(`axe sem violacoes (${tema})`, async () => {
      document.documentElement.setAttribute('data-theme', tema);
      const { container } = render(ui('Sub'));
      expect((await axe(container)).violations).toEqual([]);
    });
  }
});
