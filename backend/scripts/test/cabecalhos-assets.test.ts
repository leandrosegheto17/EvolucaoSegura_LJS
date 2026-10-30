import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { createTestHarness } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cabecalhosDeSeguranca } from '../../api/src/middleware/cabecalhos.ts';

// OPS-09 e SEC-002 (T214): as páginas e o JS do app (assets, fora de run_worker_first) saem com os
// mesmos cabeçalhos de segurança que o middleware da API põe em /api/*. Quem os põe é o
// frontend/web/public/_headers, que o Vite copia para o dist.
// Sobe o Worker de verdade (workerd, pelo harness do wrangler) com o wrangler.jsonc do repositório e
// um dist de exemplo que leva o _headers real: no CI os testes rodam antes do build do web.

const raiz = resolve(import.meta.dirname, '../../..');
const arquivoHeaders = join(raiz, 'frontend/web/public/_headers');
const pastaTemporaria = mkdtempSync(join(tmpdir(), 'assets-cabecalhos-'));
const distDeExemplo = join(pastaTemporaria, 'dist');

const config = parse(readFileSync(join(raiz, 'wrangler.jsonc'), 'utf8')) as {
  main: string;
  assets: { directory: string };
  [chave: string]: unknown;
};

const servidor = createTestHarness({
  root: raiz,
  workers: [
    {
      config: {
        ...config,
        main: join(raiz, config.main),
        assets: { ...config.assets, directory: distDeExemplo },
      } as never,
    },
  ],
});

beforeAll(async () => {
  mkdirSync(join(distDeExemplo, 'assets'), { recursive: true });
  writeFileSync(join(distDeExemplo, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(distDeExemplo, 'sw.js'), 'self.addEventListener("install", () => {});');
  writeFileSync(join(distDeExemplo, 'assets', 'app.js'), 'console.log("exemplo");');
  copyFileSync(arquivoHeaders, join(distDeExemplo, '_headers'));
  await servidor.listen();
}, 120_000);

afterAll(async () => {
  await servidor.close();
  rmSync(pastaTemporaria, { recursive: true, force: true });
});

// Lê o _headers no formato da Cloudflare: linha sem recuo = padrão de caminho; recuada = "Nome: valor".
function regrasDoArquivo(): Map<string, Record<string, string>> {
  const regras = new Map<string, Record<string, string>>();
  let atual: Record<string, string> | null = null;
  for (const linha of readFileSync(arquivoHeaders, 'utf8').split(/\r?\n/)) {
    if (linha.trim() === '' || linha.trim().startsWith('#')) continue;
    if (!/^\s/.test(linha)) {
      atual = {};
      regras.set(linha.trim(), atual);
      continue;
    }
    const separador = linha.indexOf(':');
    if (atual === null || separador < 0) throw new Error(`linha inválida no _headers: ${linha}`);
    atual[linha.slice(0, separador).trim()] = linha.slice(separador + 1).trim();
  }
  return regras;
}

describe('_headers do front (SEC-002)', () => {
  it('tem uma regra para /* com exatamente os valores do middleware cabecalhos.ts', () => {
    expect(regrasDoArquivo().get('/*')).toEqual(cabecalhosDeSeguranca);
  });

  it('o middleware traz os cinco controles exigidos (a comparação acima não é vazia)', () => {
    expect(cabecalhosDeSeguranca['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(cabecalhosDeSeguranca['Strict-Transport-Security']).toMatch(/^max-age=\d+/);
    expect(cabecalhosDeSeguranca['X-Content-Type-Options']).toBe('nosniff');
    expect(cabecalhosDeSeguranca['Referrer-Policy']).toBe('no-referrer');
  });
});

describe.each(['/', '/app/inicio', '/sw.js', '/assets/app.js'])(
  'resposta de %s (asset, sem passar pelo Hono)',
  (caminho) => {
    it('responde 200 com CSP, HSTS, nosniff, Referrer-Policy e frame-ancestors iguais aos da API', async () => {
      const resposta = await servidor.fetch(caminho);
      await resposta.arrayBuffer();

      expect(resposta.status).toBe(200);
      for (const [nome, valor] of Object.entries(cabecalhosDeSeguranca)) {
        expect(resposta.headers.get(nome), nome).toBe(valor);
      }
      expect(resposta.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    });
  },
);

describe('a API continua com os mesmos valores', () => {
  it('/api/health traz os cabeçalhos do middleware, sem duplicar', async () => {
    const resposta = await servidor.fetch('/api/health');
    await resposta.arrayBuffer();

    for (const [nome, valor] of Object.entries(cabecalhosDeSeguranca)) {
      expect(resposta.headers.get(nome), nome).toBe(valor);
    }
  });
});
