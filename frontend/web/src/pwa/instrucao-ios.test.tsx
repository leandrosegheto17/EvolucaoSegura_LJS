import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_DISPENSA, InstrucaoIos, ehSafariIosForaDoApp } from './instrucao-ios.tsx';

// T157 / PUB-04: no Safari do iOS fora do modo instalado, o app oferece a instrução de instalação
// ("Compartilhar" -> "Adicionar à Tela de Início"). Aparece só nesse caso; dispensar lembra a
// escolha (localStorage).

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';
const FIREFOX_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

function ambiente(ua: string, opcoes: { instalado?: boolean; toques?: number } = {}) {
  vi.stubGlobal('navigator', {
    userAgent: ua,
    standalone: opcoes.instalado ?? false,
    maxTouchPoints: opcoes.toques ?? 0,
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ehSafariIosForaDoApp', () => {
  it('Safari do iPhone no navegador: sim', () => {
    ambiente(SAFARI_IPHONE);
    expect(ehSafariIosForaDoApp()).toBe(true);
  });

  it('iPad com Safari em modo desktop (Macintosh com toque): sim', () => {
    ambiente(SAFARI_MAC, { toques: 5 });
    expect(ehSafariIosForaDoApp()).toBe(true);
  });

  it('já instalado (modo standalone): não', () => {
    ambiente(SAFARI_IPHONE, { instalado: true });
    expect(ehSafariIosForaDoApp()).toBe(false);
  });

  it('Chrome e Firefox do iOS, Android e Safari do Mac: não', () => {
    for (const ua of [CHROME_IPHONE, FIREFOX_IPHONE, CHROME_ANDROID, SAFARI_MAC]) {
      ambiente(ua);
      expect(ehSafariIosForaDoApp(), ua).toBe(false);
    }
  });
});

describe('<InstrucaoIos />', () => {
  it('no Safari do iOS fora do modo instalado mostra a instrução com Compartilhar e Adicionar à Tela de Início', () => {
    ambiente(SAFARI_IPHONE);
    render(<InstrucaoIos />);
    const aviso = screen.getByRole('region', { name: /instalar o app/i });
    expect(aviso.textContent).toMatch(/Compartilhar/);
    expect(aviso.textContent).toMatch(/Adicionar à Tela de Início/);
  });

  it('fora do Safari do iOS não mostra nada', () => {
    ambiente(CHROME_ANDROID);
    render(<InstrucaoIos />);
    expect(screen.queryByRole('region', { name: /instalar o app/i })).toBeNull();
  });

  it('instalado não mostra nada', () => {
    ambiente(SAFARI_IPHONE, { instalado: true });
    render(<InstrucaoIos />);
    expect(screen.queryByRole('region', { name: /instalar o app/i })).toBeNull();
  });

  it('dispensar esconde a instrução, grava a escolha e ela não volta ao reabrir', () => {
    ambiente(SAFARI_IPHONE);
    const primeira = render(<InstrucaoIos />);
    fireEvent.click(screen.getByRole('button', { name: /dispensar/i }));
    expect(screen.queryByRole('region', { name: /instalar o app/i })).toBeNull();
    expect(localStorage.getItem(CHAVE_DISPENSA)).toBe('1');
    primeira.unmount();
    render(<InstrucaoIos />);
    expect(screen.queryByRole('region', { name: /instalar o app/i })).toBeNull();
  });
});
