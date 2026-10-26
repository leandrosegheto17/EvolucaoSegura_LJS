import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QueryFetchState } from './QueryFetchState';

const base = { errorMessage: 'Falhou ao carregar.', onRetry: () => {}, skeletonClassName: 'h-32' };

describe('QueryFetchState', () => {
  it('mostra o esqueleto enquanto carrega', () => {
    const { container } = render(<QueryFetchState {...base} isPending isError={false} />);
    expect(container.querySelector('.h-32')).not.toBeNull();
    expect(screen.queryByText('Falhou ao carregar.')).toBeNull();
  });

  it('mostra erro e permite tentar novamente', async () => {
    const onRetry = vi.fn();
    render(<QueryFetchState {...base} onRetry={onRetry} isPending={false} isError />);
    expect(screen.getByText('Falhou ao carregar.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('não renderiza nada quando pronta', () => {
    const { container } = render(<QueryFetchState {...base} isPending={false} isError={false} />);
    expect(container.innerHTML).toBe('');
  });
});
