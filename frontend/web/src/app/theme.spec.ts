import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  initTheme,
  readPreference,
  setTheme,
  subscribeTheme,
  useEffectiveTheme,
  useThemePreference,
} from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('tema', () => {
  it('padrao e system, sem atributo', () => {
    expect(initTheme()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('dark/light aplicam atributo e persistem so a preferencia', () => {
    setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    setTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(readPreference()).toBe('system');
  });
  it('valor invalido cai em system', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readPreference()).toBe('system');
  });
  it('tolera localStorage indisponivel', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPreference()).toBe('system');
    expect(() => setTheme('light')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    vi.restoreAllMocks();
    applyTheme('system');
  });
  it('subscribeTheme notifica e cancela', () => {
    const fn = vi.fn();
    const off = subscribeTheme(fn);
    setTheme('dark');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setTheme('light');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('dois consumidores do hook refletem a mesma preferencia; so a chave e gravada', () => {
    setTheme('system');
    const a = renderHook(() => useThemePreference());
    const b = renderHook(() => useThemePreference());
    expect(a.result.current).toBe('system');
    act(() => setTheme('dark'));
    expect(a.result.current).toBe('dark');
    expect(b.result.current).toBe('dark');
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    act(() => setTheme('system'));
    expect(b.result.current).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('setTheme revalida', () => {
  it('ignora valor invalido sem persistir nem aplicar', () => {
    setTheme('dark');
    setTheme('rosa' as never);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('useEffectiveTheme', () => {
  let matches = false;
  const ls = new Set<() => void>();
  beforeEach(() => {
    matches = false;
    ls.clear();
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, l: () => void) => ls.add(l),
      removeEventListener: (_: string, l: () => void) => ls.delete(l),
    }));
    act(() => setTheme('system'));
  });
  afterEach(() => vi.unstubAllGlobals());
  const fire = (v: boolean) =>
    act(() => {
      matches = v;
      ls.forEach((l) => l());
    });

  it('system segue o SO e reage a change', () => {
    const { result } = renderHook(() => useEffectiveTheme());
    expect(result.current).toEqual({
      preferencia: 'system',
      efetivo: 'light',
      escolhaExplicita: false,
    });
    fire(true);
    expect(result.current.efetivo).toBe('dark');
    fire(false);
    expect(result.current.efetivo).toBe('light');
  });
  it('escolha explicita ignora o SO', () => {
    const { result } = renderHook(() => useEffectiveTheme());
    act(() => setTheme('light'));
    fire(true);
    expect(result.current).toEqual({
      preferencia: 'light',
      efetivo: 'light',
      escolhaExplicita: true,
    });
    act(() => setTheme('dark'));
    fire(false);
    expect(result.current.efetivo).toBe('dark');
  });
  it('sem escrita nova no localStorage e cancela assinatura', () => {
    const { unmount } = renderHook(() => useEffectiveTheme());
    expect(ls.size).toBe(1);
    fire(true);
    expect(localStorage.length).toBe(1);
    unmount();
    expect(ls.size).toBe(0);
  });
});
