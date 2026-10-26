import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * Comportamento comum de menus em disclosure: estado aberto, foco inicial no primeiro/ultimo item, fechamento ao
 * clicar fora (mousedown/touchstart; so devolve o foco ao botao se o clique nao caiu em outro alvo focavel) e
 * navegacao por Esc/Setas/Home/End. Tab fica por conta de quem consome, pois difere entre menu e dialog.
 */
export function useDisclosureMenu<P extends HTMLElement>(itemSelector: string) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<'first' | 'last'>('first');
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<P>(null);

  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(itemSelector) ?? []);

  useEffect(() => {
    if (!open) return;
    const list = items();
    (start === 'last' ? list[list.length - 1] : list[0])?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Element | null;
      if (rootRef.current?.contains(t as Node)) return;
      setOpen(false);
      const other = t && 'closest' in t ? t.closest(FOCUSABLE) : null;
      if (!other) setTimeout(() => btnRef.current?.focus(), 0);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  function closeToButton() {
    setOpen(false);
    btnRef.current?.focus();
  }

  /** Trata Esc/Setas/Home/End; devolve true quando a tecla foi consumida. */
  function onNavKey(e: KeyboardEvent): boolean {
    const list = items();
    const i = list.findIndex((el) => el === document.activeElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      closeToButton();
    } else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else return false;
    return true;
  }

  return { open, setOpen, start, setStart, rootRef, btnRef, panelRef, items, closeToButton, onNavKey };
}
