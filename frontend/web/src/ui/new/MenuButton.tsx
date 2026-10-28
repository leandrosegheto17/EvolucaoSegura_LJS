import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useDisclosureMenu } from './useDisclosureMenu';

export interface MenuButtonItem {
  label: string;
  to: string;
  icon?: ReactNode;
}

export interface MenuButtonProps {
  /** Texto visivel do botao. */
  label: string;
  items: MenuButtonItem[];
  /** Nome acessivel do botao, quando diferente do texto visivel. */
  ariaLabel?: string;
  /** Icone decorativo antes do texto (aria-hidden). */
  icon?: ReactNode;
}

/** Menu button (WAI-ARIA APG) com itens que sao links (RF-55b, A-1). Itens por props. */
export function MenuButton({ label, items, ariaLabel, icon }: MenuButtonProps) {
  const {
    open,
    setOpen,
    setStart,
    rootRef,
    btnRef,
    panelRef: menuRef,
    closeToButton,
    onNavKey,
  } = useDisclosureMenu<HTMLUListElement>('[role="menuitem"]');
  const menuId = useId();

  function onButtonKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setStart(e.key === 'ArrowUp' ? 'last' : 'first');
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (onNavKey(e)) return;
    if (e.key === 'Tab') {
      // fecha e devolve o foco ao botao; o Tab segue a ordem natural a partir dele
      if (e.shiftKey) e.preventDefault();
      closeToButton();
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          setStart('first');
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKeyDown}
        className="flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-card border border-line bg-surf px-3 text-ink focus-visible:outline-4 focus-visible:outline-focus"
      >
        {icon && <span aria-hidden="true">{icon}</span>}
        <span>{label}</span>
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable={false}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-50 mt-1 w-64 max-w-[calc(100vw-1rem)] list-none rounded-card border border-line bg-surf p-2 shadow-lg"
        >
          {items.map((it) => (
            <li key={it.to + it.label} role="none">
              <Link
                to={it.to}
                role="menuitem"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center gap-3 rounded-card px-3 text-ink focus-visible:outline-4 focus-visible:outline-focus"
              >
                {it.icon}
                <span>{it.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
