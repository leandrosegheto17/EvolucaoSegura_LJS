import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDisclosureMenu } from './useDisclosureMenu';

function Harness() {
  const { open, setOpen, rootRef, btnRef, panelRef, onNavKey } =
    useDisclosureMenu<HTMLDivElement>('button');
  return (
    <div>
      <div ref={rootRef} onKeyDown={open ? onNavKey : undefined}>
        <button ref={btnRef} type="button" onClick={() => setOpen((v) => !v)}>
          abrir
        </button>
        {open && (
          <div ref={panelRef}>
            <button type="button">a</button>
            <button type="button">b</button>
            <button type="button">c</button>
          </div>
        )}
      </div>
      <p data-testid="fora">fora</p>
    </div>
  );
}

describe('useDisclosureMenu', () => {
  it('foca o primeiro item ao abrir e fecha ao clicar fora', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('abrir'));
    expect(screen.getByText('a')).toHaveFocus();
    fireEvent.mouseDown(screen.getByTestId('fora'));
    expect(screen.queryByText('a')).toBeNull();
  });

  it('Esc fecha e devolve o foco ao botao', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('abrir'));
    fireEvent.keyDown(screen.getByText('a'), { key: 'Escape' });
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.getByText('abrir')).toHaveFocus();
  });

  it('Home, End e setas navegam com volta circular', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('abrir'));
    fireEvent.keyDown(screen.getByText('a'), { key: 'End' });
    expect(screen.getByText('c')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('c'), { key: 'ArrowDown' });
    expect(screen.getByText('a')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('a'), { key: 'ArrowUp' });
    expect(screen.getByText('c')).toHaveFocus();
    fireEvent.keyDown(screen.getByText('c'), { key: 'Home' });
    expect(screen.getByText('a')).toHaveFocus();
  });
});
