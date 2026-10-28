import { useState } from 'react';

// PUB-04 (T157): no Safari do iOS fora do modo instalado, orienta "Compartilhar" -> "Adicionar à
// Tela de Início" (o iOS não oferece o aviso de instalação sozinho). Dispensar grava a escolha no
// aparelho (localStorage) e a instrução não volta.
// PREMISSA: Chrome e Firefox do iOS (CriOS, FxiOS) ficam de fora: neles o caminho é outro. iPad em
// modo desktop (UA Macintosh com tela de toque) conta como iOS. Texto escrito pelo implementador.
export const CHAVE_DISPENSA = 'es:instrucao-ios-dispensada';

type NavegadorIos = Navigator & { standalone?: boolean };

export function ehSafariIosForaDoApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavegadorIos;
  const ua = nav.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  if (!ios || /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
  return nav.standalone !== true;
}

function jaDispensada(): boolean {
  try {
    return localStorage.getItem(CHAVE_DISPENSA) === '1';
  } catch {
    return false;
  }
}

export function InstrucaoIos() {
  const [oculta, setOculta] = useState(jaDispensada);
  if (oculta || !ehSafariIosForaDoApp()) return null;

  function dispensar() {
    try {
      localStorage.setItem(CHAVE_DISPENSA, '1');
    } catch {
      // Sem armazenamento, a instrução some só nesta visita.
    }
    setOculta(true);
  }

  return (
    <section aria-label="Instalar o app" className="m-3 flex flex-col gap-2 rounded border p-3">
      <p>
        Para instalar o Evolução Segura neste aparelho, toque em <strong>Compartilhar</strong> no
        Safari e depois em <strong>Adicionar à Tela de Início</strong>.
      </p>
      <button
        type="button"
        onClick={dispensar}
        className="self-start rounded border px-3 py-1 text-sm"
      >
        Dispensar
      </button>
    </section>
  );
}
