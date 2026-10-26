import { useId } from 'react';
import { setTheme, useEffectiveTheme } from '../theme';

/** Chave "Modo escuro" (RF-52a..e): estado = tema efetivo; alternar grava dark/light. */
export function ThemeSwitch() {
  const { efetivo } = useEffectiveTheme();
  const labelId = useId();
  const on = efetivo === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      onClick={() => setTheme(on ? 'light' : 'dark')}
      className="flex min-h-11 min-w-11 w-full items-center gap-3 rounded-card px-3 text-left text-ink focus-visible:outline-4 focus-visible:outline-focus"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      <span id={labelId} className="flex-1">
        Modo escuro
      </span>
      <span
        aria-hidden="true"
        data-track=""
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full border ${on ? 'border-pri bg-pri' : 'border-field bg-line'}`}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-surf"
          style={{ left: on ? '1.5rem' : '0.125rem' }}
        />
      </span>
      <span aria-hidden="true" className="w-16 text-sm">
        {on ? 'Ligado' : 'Desligado'}
      </span>
    </button>
  );
}
