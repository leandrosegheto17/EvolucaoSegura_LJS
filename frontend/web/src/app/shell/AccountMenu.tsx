import { useEffect, useId, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useDisclosureMenu } from '../../ui/new/useDisclosureMenu';
import { useSignOut } from '../sair.ts';
import { useProfileName } from '../perfil/api.ts';
import { ThemeSwitch } from './ThemeSwitch';

const svgProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

function PersonIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...svgProps} width={size} height={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

/** Menu da conta (RF-51c..e, SH-1): disclosure com dialog NAO modal (RT-P). */
export function AccountMenu() {
  const { nome, iniciais } = useProfileName();
  const signOut = useSignOut();
  const { open, setOpen, rootRef, btnRef, panelRef, items, closeToButton, onNavKey } =
    useDisclosureMenu<HTMLDivElement>('a[href],button');
  const panelId = useId();

  // Mobile (<= 860 px): o painel cobre o conteudo da pagina, que fica inerte enquanto o menu esta aberto, para nenhum
  // alvo da pagina ficar parcialmente encoberto pelo painel (WCAG 2.5.8, axe target-size). O menu continua nao modal:
  // sem armadilha de foco (Tab/Shift+Tab/Esc seguem devolvendo o foco ao botao).
  useEffect(() => {
    if (
      !open ||
      typeof window.matchMedia !== 'function' ||
      !window.matchMedia('(max-width: 860px)').matches
    )
      return;
    const main = document.getElementById('conteudo');
    if (!main) return;
    main.inert = true;
    return () => {
      main.inert = false;
    };
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (onNavKey(e)) return;
    const list = items();
    const i = list.findIndex((el) => el === document.activeElement);
    if (e.key === 'Tab' && i >= 0) {
      if (e.shiftKey && i === 0) {
        e.preventDefault();
        closeToButton();
      } else if (!e.shiftKey && i === list.length - 1) {
        // devolve o foco ao botao e deixa o Tab seguir a ordem natural a partir dele
        setOpen(false);
        btnRef.current?.focus();
      }
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={nome ? `Conta de ${nome}` : 'Conta'}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 min-w-12 items-center justify-center gap-1 rounded-card px-1 text-ink focus-visible:outline-4 focus-visible:outline-focus"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-pri text-sm font-semibold text-onpri"
        >
          {iniciais || <PersonIcon />}
        </span>
        <svg {...svgProps} width={14} height={14}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Conta"
          className="absolute right-0 z-50 mt-1 w-64 max-w-[calc(100vw-1rem)] rounded-card border border-line bg-surf p-2 shadow-lg"
        >
          {nome && (
            <div className="flex items-center gap-2 px-3 py-2">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pri text-sm font-semibold text-onpri"
              >
                {iniciais}
              </span>
              <strong className="break-words text-ink">{nome}</strong>
            </div>
          )}
          <Link
            to="/app/perfil"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-card px-3 text-ink focus-visible:outline-4 focus-visible:outline-focus"
          >
            <PersonIcon />
            <span>Editar perfil</span>
          </Link>
          <ThemeSwitch />
          <hr className="my-1 border-line" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-card px-3 text-left text-err focus-visible:outline-4 focus-visible:outline-focus"
          >
            <svg {...svgProps}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            <span>Sair</span>
          </button>
        </div>
      )}
    </div>
  );
}
