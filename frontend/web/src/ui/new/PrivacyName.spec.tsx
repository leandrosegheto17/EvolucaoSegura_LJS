import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrivacyName } from './PrivacyName';

const NOME = 'Zeferino Sentinela Xavier';

describe('PrivacyName modo estrito (RF-54d, SEC-25)', () => {
  it('estrito + privado: iniciais em texto/title/nome acessivel; nenhum atributo com nome completo', () => {
    const { container } = render(<PrivacyName nome={NOME} privado nomeAcessivel="exibido" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveTextContent('Z. S. X.');
    expect(el.getAttribute('aria-label')).toBe('Z. S. X.');
    expect(el.getAttribute('title')).toBe('Z. S. X.');
    expect(container.outerHTML).not.toContain('Zeferino');
    expect(container.outerHTML).not.toContain('Sentinela');
    expect(screen.getByRole('img', { name: 'Z. S. X.' })).toBeInTheDocument();
  });

  it('estrito + privacidade desligada: nome completo', () => {
    const { container } = render(<PrivacyName nome={NOME} privado={false} nomeAcessivel="exibido" />);
    expect(container).toHaveTextContent(NOME);
  });

  it('padrao "completo" preserva o DOM atual', () => {
    const { container, rerender } = render(<PrivacyName nome={NOME} privado />);
    expect(container.innerHTML).toBe(`<span role="img" aria-label="${NOME}">Z. S. X.</span>`);
    rerender(<PrivacyName nome={NOME} nomeAcessivel="completo" />);
    expect(container.innerHTML).toBe(`<span>${NOME}</span>`);
  });
});
