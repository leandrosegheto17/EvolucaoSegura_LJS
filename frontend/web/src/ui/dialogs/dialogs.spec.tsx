import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ConfirmDeliverDialog, ConflictDialog, SessionTimeoutDialog } from './index';

afterEach(() => vi.useRealTimers());

describe('ConfirmDeliverDialog', () => {
  it('sem violações axe e com texto do UX-SPEC', async () => {
    render(<ConfirmDeliverDialog open onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'não poderá ser modificado nem retificado',
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
  it('Esc cancela e nunca confirma', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDeliverDialog open onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('foco inicial no Cancelar, trap e retorno ao gatilho', async () => {
    function Host() {
      const [o, setO] = useState(false);
      return (
        <>
          <button onClick={() => setO(true)}>abrir</button>
          <ConfirmDeliverDialog
            open={o}
            onConfirm={() => setO(false)}
            onCancel={() => setO(false)}
          />
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByText('abrir');
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('alertdialog').contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});

describe('ConflictDialog', () => {
  it('axe, ações e Esc só fecha', async () => {
    const onReload = vi.fn();
    const onClose = vi.fn();
    render(<ConflictDialog open onReload={onReload} onClose={onClose} />);
    expect(await axe(document.body)).toHaveNoViolations();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(onReload).not.toHaveBeenCalled();
  });
  it('recarregar chama onReload', async () => {
    const onReload = vi.fn();
    render(<ConflictDialog open onReload={onReload} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Recarregar/ }));
    expect(onReload).toHaveBeenCalled();
  });
});

describe('SessionTimeoutDialog', () => {
  it('axe e contagem anunciada; prorrogar', async () => {
    const onExtend = vi.fn();
    render(<SessionTimeoutDialog open onExtend={onExtend} onExpire={() => {}} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('2:00');
    expect(await axe(document.body)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar conectado' }));
    expect(onExtend).toHaveBeenCalled();
  });
  it('Esc prorroga, não encerra', async () => {
    const onExtend = vi.fn();
    const onExpire = vi.fn();
    render(<SessionTimeoutDialog open onExtend={onExtend} onExpire={onExpire} />);
    await userEvent.keyboard('{Escape}');
    expect(onExtend).toHaveBeenCalled();
    expect(onExpire).not.toHaveBeenCalled();
  });
  it('conta regressiva e expira ao zerar', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<SessionTimeoutDialog open secondsLeft={3} onExtend={() => {}} onExpire={onExpire} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('0:02');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
