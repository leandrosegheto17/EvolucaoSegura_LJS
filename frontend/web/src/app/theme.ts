import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'theme-preference';

const VALID: readonly string[] = ['light', 'dark', 'system'];

export function isThemePreference(v: unknown): v is ThemePreference {
  return typeof v === 'string' && VALID.includes(v);
}

export function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Persiste SOMENTE a preferencia (nunca dados clinicos/sessao). */
export function savePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* armazenamento indisponivel: preferencia vale so na sessao */
  }
}

/** 'system' remove o atributo e deixa o prefers-color-scheme de tokens.css agir. */
export function applyTheme(
  pref: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

/** Preferencia da sessao (memoria); null = ainda nao lida do armazenamento. */
let current: ThemePreference | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemePreference {
  if (current === null) current = readPreference();
  return current;
}

export function setTheme(pref: ThemePreference): void {
  if (!isThemePreference(pref)) return;
  savePreference(pref);
  applyTheme(pref);
  current = pref;
  notify();
}

/** Preferencia compartilhada: todos os consumidores refletem o ultimo setTheme. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, getSnapshot, () => 'system');
}

export interface EffectiveTheme {
  preferencia: ThemePreference;
  efetivo: 'light' | 'dark';
  /** true quando o usuario escolheu dark/light (nao segue o SO). */
  escolhaExplicita: boolean;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemMql(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_QUERY)
    : null;
}

function subscribeSystemDark(listener: () => void): () => void {
  const mql = systemMql();
  if (!mql) return () => {};
  mql.addEventListener('change', listener);
  return () => mql.removeEventListener('change', listener);
}

function getSystemDark(): boolean {
  return systemMql()?.matches ?? false;
}

/** Tema efetivo: preferencia + prefers-color-scheme (reativo, sem rede nem novo storage). */
export function useEffectiveTheme(): EffectiveTheme {
  const preferencia = useThemePreference();
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);
  const escolhaExplicita = preferencia !== 'system';
  const efetivo = escolhaExplicita
    ? (preferencia as 'light' | 'dark')
    : systemDark
      ? 'dark'
      : 'light';
  return { preferencia, efetivo, escolhaExplicita };
}

export function initTheme(): ThemePreference {
  const pref = readPreference();
  applyTheme(pref);
  current = pref;
  notify();
  return pref;
}
