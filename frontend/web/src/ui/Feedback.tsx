import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './classes';

export type Tone = 'ok' | 'warn' | 'err';

const TONE_BG: Record<Tone, string> = {
  ok: 'bg-(--okbg) text-ok border-ok',
  warn: 'bg-(--warnbg) text-warn border-warn',
  err: 'bg-(--errbg) text-err border-err',
};
const TONE_ICON: Record<Tone, string> = { ok: '✓', warn: '!', err: '✕' };
const TONE_NAME: Record<Tone, string> = { ok: 'Sucesso', warn: 'Atenção', err: 'Erro' };

/** Borda esquerda de 6 px; erro anunciado com role=alert, demais com status. */
export function Alert({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      className={cx('rounded-card border-l-[6px] p-4', TONE_BG[tone], className)}
    >
      <span className="sr-only">{TONE_NAME[tone]}: </span>
      {children}
    </div>
  );
}

/** Icone sempre acompanhado de texto (cor nunca e o unico sinal). */
export function Badge({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-semibold', TONE_BG[tone])}>
      <span aria-hidden="true">{icon ?? TONE_ICON[tone]}</span>
      {children}
    </span>
  );
}

export function Seal({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border-2 border-pri px-3 py-0.5 text-sm font-semibold text-pri">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 12l5 5 9-10" />
      </svg>
      {children}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border-2 border-dashed border-line p-6 text-center">
      <p className="font-heading font-bold text-ink">{title}</p>
      {children && <div className="mt-2 text-mut">{children}</div>}
    </div>
  );
}

/** Animacao so quando o usuario nao pede movimento reduzido. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando"
      className={cx('h-6 rounded-card bg-soft motion-safe:animate-pulse', className)}
      {...rest}
    />
  );
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-mut">
      <span
        aria-hidden="true"
        className="size-5 rounded-full border-2 border-line border-t-pri motion-safe:animate-spin"
      />
      {label}
    </span>
  );
}
