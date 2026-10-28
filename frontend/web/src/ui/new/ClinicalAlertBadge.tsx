import { useId, useState } from 'react';
import { cx, FOCUS, TARGET } from '../classes';
import { AlertIcon } from './icons';

/** Selo RF-25a: renderiza so quando ha alertas; lista em popover acessivel (botao + aria-expanded). */
export function ClinicalAlertBadge({ alertas }: { alertas: string[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (alertas.length === 0) return null;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className={cx(
          'inline-flex items-center gap-1 rounded-full border border-err bg-(--errbg) px-3 text-sm font-semibold text-err',
          TARGET,
          FOCUS,
        )}
      >
        <AlertIcon />
        Alerta clínico
      </button>
      {open && (
        <ul
          id={id}
          className="absolute z-10 mt-1 min-w-48 rounded-card border border-line bg-surf p-3 text-ink shadow-(--sh)"
        >
          {alertas.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </span>
  );
}
