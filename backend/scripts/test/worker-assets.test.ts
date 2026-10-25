import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { createTestHarness } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// PUB-05 e OPS-03 (T24): o Worker serve o front como assets e a API Hono em /api/*.
// Sobe o Worker de verdade (workerd, pelo harness do wrangler) com o wrangler.jsonc do repositório.
// O diretório de assets vem de um dist de exemplo criado aqui: no CI os testes rodam antes do
// build do web, então o teste não pode depender do dist real. Todo o resto da config (main,
// compatibilidade, run_worker_first, not_found_handling) é o do wrangler.jsonc.

const raiz = resolve(import.meta.dirname, '../../..');
const pastaTemporaria = mkdtempSync(join(tmpdir(), 'assets-'));
const distDeExemplo = join(pastaTemporaria, 'dist');
const MARCADOR_INDEX = '<!-- index-de-exemplo -->';

const config = parse(readFileSync(join(raiz, 'wrangler.jsonc'), 'utf8')) as {
  main: string;
  assets: { directory: string; not_found_handling: string; run_worker_first: string[] };
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
  writeFileSync(
    join(distDeExemplo, 'index.html'),
    `<!doctype html>${MARCADOR_INDEX}<div id="root"></div>`,
  );
  writeFileSync(join(distDeExemplo, 'assets', 'app.js'), 'console.log("arquivo-de-exemplo");');
  await servidor.listen();
}, 120_000);

afterAll(async () => {
  await servidor.close();
  rmSync(pastaTemporaria, { recursive: true, force: true });
});

describe('Worker com assets e API', () => {
  it('configura run_worker_first só para /api/* e fallback de SPA', () => {
    expect(config.assets.run_worker_first).toEqual(['/api/*']);
    expect(config.assets.not_found_handling).toBe('single-page-application');
    expect(config.assets.directory).toBe('./frontend/web/dist');
  });

  it('/api/* cai no Hono', async () => {
    const resposta = await servidor.fetch('/api/health');

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ status: 'ok' });
    expect(resposta.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rota inexistente de /api/* é 404 do Hono, não o index.html do front', async () => {
    const resposta = await servidor.fetch('/api/nao-existe');

    expect(resposta.status).toBe(404);
    expect(await resposta.text()).not.toContain(MARCADOR_INDEX);
    expect(resposta.headers.get('Cache-Control')).toBe('no-store');
  });

  it('as demais rotas vão para o front: arquivo existente é entregue como está', async () => {
    const resposta = await servidor.fetch('/assets/app.js');

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe('console.log("arquivo-de-exemplo");');
  });

  it('rota desconhecida do front devolve o index.html', async () => {
    const resposta = await servidor.fetch('/app/uma/rota/que/nao/existe');

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('Content-Type')).toContain('text/html');
    expect(await resposta.text()).toContain(MARCADOR_INDEX);
  });
});
