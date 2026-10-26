import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';

export interface ShortcutTileProps {
  to: string;
  label: string;
  icon: ReactNode;
  // T64: `| undefined` só para o exactOptionalPropertyTypes deste projeto.
  subtitle?: string | undefined;
}

/** Atalho da Ficha (RF-55c/d): um unico Link; sem contagem/valor. */
export function ShortcutTile({ to, label, icon, subtitle }: ShortcutTileProps) {
  const id = useId();
  const labelId = `${id}-l`;
  const subId = `${id}-s`;
  return (
    <Link
      to={to}
      aria-labelledby={labelId}
      aria-describedby={subtitle ? subId : undefined}
      className="flex min-h-[72px] min-w-11 items-center gap-3 rounded-lg border border-(--line) bg-(--card) px-4 py-3 text-ink no-underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(--focus)"
    >
      <span aria-hidden="true" className="shrink-0 text-(--pri)">{icon}</span>
      <span className="flex flex-col">
        <span id={labelId} className="font-semibold">{label}</span>
        {subtitle && <span id={subId} className="text-sm text-mut">{subtitle}</span>}
      </span>
    </Link>
  );
}
