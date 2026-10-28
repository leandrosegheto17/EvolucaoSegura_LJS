import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifesto } from './manifesto.ts';

// T156 / PUB-03: manifest com ícones 192 e 512 maskable e display standalone. É o objeto que o
// vite-plugin-pwa grava em manifest.webmanifest; "instalável pelo Chrome" exige ainda nome,
// start_url e os dois ícones existindo de verdade (checagem manual do Chrome registrada à parte).

const publico = resolve(import.meta.dirname, '../../public');

describe('manifesto do PWA', () => {
  it('usa display standalone e tem nome e start_url', () => {
    expect(manifesto.display).toBe('standalone');
    expect(manifesto.name).toBe('Evolução Segura');
    expect(manifesto.start_url).toBe('/app');
  });

  it('traz os ícones 192 e 512 com propósito maskable', () => {
    const por = (tamanho: string) => manifesto.icons.filter((i) => i.sizes === tamanho);
    for (const tamanho of ['192x192', '512x512']) {
      const maskable = por(tamanho).find((i) => i.purpose.split(' ').includes('maskable'));
      expect(maskable, tamanho).toBeDefined();
      expect(maskable?.type).toBe('image/png');
    }
  });

  it('aponta para arquivos de ícone que existem', () => {
    for (const icone of manifesto.icons)
      expect(existsSync(resolve(publico, icone.src.replace(/^\//, ''))), icone.src).toBe(true);
  });

  it('o manifest gerado no build, quando há dist, é igual ao objeto', () => {
    const gerado = resolve(import.meta.dirname, '../../dist/manifest.webmanifest');
    if (!existsSync(gerado)) return;
    const lido = JSON.parse(readFileSync(gerado, 'utf8')) as typeof manifesto;
    expect(lido.display).toBe('standalone');
    expect(lido.icons.map((i) => `${i.sizes}:${i.purpose}`).sort()).toEqual(
      manifesto.icons.map((i) => `${i.sizes}:${i.purpose}`).sort(),
    );
  });
});
