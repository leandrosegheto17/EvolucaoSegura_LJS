import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';
import { StatCard } from './StatCard';

afterEach(() => document.documentElement.removeAttribute('data-theme'));

const barra = (c: HTMLElement) =>
  c.querySelector('[data-testid="stat-progresso-barra"]') as HTMLElement;

describe('StatCard (RF-53c/d)', () => {
  it('sem props novas: DOM identico ao anterior', () => {
    const { container } = render(<StatCard label="Sessões" value={12} hint="2 a mais" />);
    expect(container.innerHTML).toContain(
      '<p class="text-mut">Sessões</p><p class="font-heading text-3xl font-extrabold text-ink">12</p><p class="text-sm text-mut">2 a mais</p>',
    );
    expect(container.querySelectorAll('svg, a, [aria-hidden]').length).toBe(0);
  });

  it('complemento renderiza texto', () => {
    render(<StatCard label="A" value={1} complemento="de 5 previstas" />);
    expect(screen.getByText('de 5 previstas')).toBeInTheDocument();
  });

  it('progresso: texto "X de Y" e barra aria-hidden com largura proporcional', () => {
    const { container } = render(
      <StatCard label="A" value={1} progresso={{ feito: 3, total: 4 }} />,
    );
    expect(screen.getByText('3 de 4')).toBeInTheDocument();
    expect(barra(container).closest('[aria-hidden="true"]')).not.toBeNull();
    expect(barra(container).style.width).toBe('75%');
  });

  it('progresso 0 de 0: barra vazia sem NaN', () => {
    const { container } = render(
      <StatCard label="A" value={0} progresso={{ feito: 0, total: 0 }} />,
    );
    expect(screen.getByText('0 de 0')).toBeInTheDocument();
    expect(barra(container).style.width).toBe('0%');
  });

  it('progresso limitado a 100%', () => {
    const { container } = render(
      <StatCard label="A" value={0} progresso={{ feito: 9, total: 4 }} />,
    );
    expect(barra(container).style.width).toBe('100%');
  });

  it('atencao: icone + texto + link com sr-only', () => {
    const { container } = render(
      <MemoryRouter>
        <StatCard label="A" value={1} atencao={{ texto: '2 sem registro', destino: '/agenda' }} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('2 sem registro').length).toBeGreaterThan(0);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/agenda');
    expect(link.querySelector('.sr-only')).not.toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  for (const tema of ['light', 'dark']) {
    it(`axe sem violacoes nas 3 variantes (${tema})`, async () => {
      document.documentElement.setAttribute('data-theme', tema);
      const { container } = render(
        <MemoryRouter>
          <StatCard label="A" value={1} complemento="c" />
          <StatCard label="B" value={2} progresso={{ feito: 1, total: 2 }} />
          <StatCard label="C" value={3} atencao={{ texto: 'Atenção', destino: '/x' }} />
        </MemoryRouter>,
      );
      expect((await axe(container)).violations).toEqual([]);
    });
  }
});
