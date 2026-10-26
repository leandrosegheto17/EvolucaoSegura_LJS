import { useId, useRef, useState } from 'react';
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { FOCUS, TARGET, cx } from './classes';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-card border border-line bg-surf p-4 shadow-(--sh)', className)} {...rest} />;
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label="Etapas" className="flex flex-wrap gap-3">
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={cx('flex items-center gap-2', i === current ? 'font-bold text-pri' : 'text-mut')}
        >
          <span aria-hidden="true" className="grid size-6 place-items-center rounded-full border-2 border-current text-sm">
            {i + 1}
          </span>
          {s}
          {i < current && <span className="sr-only"> (concluída)</span>}
        </li>
      ))}
    </ol>
  );
}

export type TabItem = { id: string; label: string; panel: ReactNode };

/** Padrao WAI-ARIA tabs: setas/Home/End, roving tabindex. */
export function Tabs({ tabs, label }: { tabs: TabItem[]; label: string }) {
  const base = useId();
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next =
      e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-2 border-b border-line">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-t-${t.id}`}
            aria-selected={i === active}
            aria-controls={`${base}-p-${t.id}`}
            tabIndex={i === active ? 0 : -1}
            className={cx(TARGET, FOCUS, 'border-b-4 px-4 font-semibold', i === active ? 'border-pri text-pri' : 'border-transparent text-mut')}
            onClick={() => setActive(i)}
            onKeyDown={(e) => move(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-p-${t.id}`}
          aria-labelledby={`${base}-t-${t.id}`}
          hidden={i !== active}
          tabIndex={0}
          className={cx(FOCUS, 'pt-4')}
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}

export type TableProps = {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
};

/** Table.resp: no mobile cada celula empilha com o rotulo da coluna. */
export function Table({ caption, columns, rows }: TableProps) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="pb-2 text-left font-heading font-bold">{caption}</caption>
      <thead className="max-md:sr-only">
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col" className="border-b-2 border-line p-2">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line max-md:block max-md:py-2">
            {r.map((cell, j) => (
              <td key={j} className="p-2 max-md:block">
                <span aria-hidden="true" className="font-semibold text-mut md:hidden">
                  {columns[j]}:{' '}
                </span>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
