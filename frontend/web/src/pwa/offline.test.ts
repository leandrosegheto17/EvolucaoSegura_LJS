import { describe, expect, it, vi } from 'vitest';
import {
  PAGINA_OFFLINE,
  SHELL,
  aoAtivar,
  aoBuscar,
  aoInstalar,
  registrarSwNoApp,
  type EscopoOffline,
} from './offline.ts';

// T184 / PUB-03: precache do shell e página offline.
// - Shell servido do precache: no install o service worker guarda no cache as entradas do manifest
//   do build (index.html, offline.html e os arquivos com hash); a navegação para /app/... e os
//   arquivos do precache saem do cache, sem rede.
// - Página offline servida sem rede: navegação fora de /app, com a rede caindo, recebe offline.html.
// - /api nunca passa pelo cache.
// Cache e fetch são simulados em memória.

const MANIFEST = [
  { url: '/index.html', revision: 'r1' },
  { url: '/offline.html', revision: 'r2' },
  { url: '/assets/main-abc.js', revision: null },
];

const chaveDe = (req: string | Request) =>
  typeof req === 'string' ? req : new URL(req.url).pathname;

function cacheEmMemoria() {
  const dados = new Map<string, Response>();
  return {
    dados,
    put: vi.fn(async (req: string | Request, r: Response) => {
      dados.set(chaveDe(req), r);
    }),
    match: vi.fn(async (req: string | Request) => dados.get(chaveDe(req))?.clone()),
    keys: vi.fn(async () => [...dados.keys()].map((u) => new Request(`https://app.test${u}`))),
    delete: vi.fn(async (req: string | Request) => dados.delete(chaveDe(req))),
  };
}

function escopo(rede: (url: string) => Promise<Response>) {
  const cache = cacheEmMemoria();
  const sw: EscopoOffline = {
    location: { origin: 'https://app.test' },
    caches: { open: vi.fn(async () => cache) },
    fetch: vi.fn(async (req: string | Request) => rede(chaveDe(req))),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    addEventListener: vi.fn(),
  };
  return { sw, cache };
}

const ok = (corpo: string) => new Response(corpo, { status: 200 });
const redeNormal = async (url: string) => ok(`rede:${url}`);
const semRede = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};

function eventoEspera() {
  const esperas: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void esperas.push(p), esperas };
}

function eventoBuscar(url: string, navegacao: boolean, metodo = 'GET') {
  let resposta: Promise<Response> | undefined;
  const request = new Request(`https://app.test${url}`, { method: metodo });
  Object.defineProperty(request, 'mode', { value: navegacao ? 'navigate' : 'cors' });
  return {
    evento: {
      request,
      respondWith: (p: Promise<Response>) => {
        resposta = p;
      },
    },
    resposta: () => resposta,
  };
}

async function instalado(rede = redeNormal) {
  const ctx = escopo(rede);
  const e = eventoEspera();
  aoInstalar(ctx.sw, MANIFEST, e);
  await Promise.all(e.esperas);
  return ctx;
}

describe('precache (install)', () => {
  it('guarda no cache todas as entradas do manifest do build', async () => {
    const { cache } = await instalado();
    expect([...cache.dados.keys()].sort()).toEqual(
      ['/assets/main-abc.js', '/index.html', '/offline.html'].sort(),
    );
  });

  it('ativa sem esperar a aba antiga fechar (skipWaiting)', async () => {
    const { sw } = await instalado();
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('manifest do build com URLs relativas', () => {
  it('o vite-plugin-pwa injeta "index.html" sem barra; o cache usa /index.html', async () => {
    const relativo = [
      { url: 'index.html', revision: 'r1' },
      { url: 'offline.html', revision: 'r2' },
    ];
    const ctx = escopo(redeNormal);
    const e = eventoEspera();
    aoInstalar(ctx.sw, relativo, e);
    await Promise.all(e.esperas);
    expect([...ctx.cache.dados.keys()].sort()).toEqual(['/index.html', '/offline.html']);
    const { evento, resposta } = eventoBuscar('/app', true);
    aoBuscar(ctx.sw, relativo, evento);
    expect(await (await resposta())?.text()).toBe('rede:/index.html');
  });
});

describe('ativação', () => {
  it('apaga do cache o que saiu do manifest e assume as abas', async () => {
    const { sw, cache } = await instalado();
    cache.dados.set('/assets/velho-zzz.js', ok('velho'));
    const e = eventoEspera();
    aoAtivar(sw, MANIFEST, e);
    await Promise.all(e.esperas);
    expect(cache.dados.has('/assets/velho-zzz.js')).toBe(false);
    expect(cache.dados.has('/index.html')).toBe(true);
    expect(sw.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe('shell servido do precache', () => {
  it('navegação para /app/... devolve o index.html do cache, sem chamar a rede', async () => {
    const { sw, cache } = await instalado();
    cache.dados.set('/index.html', ok('SHELL'));
    const rede = vi.mocked(sw.fetch);
    rede.mockClear();
    const { evento, resposta } = eventoBuscar('/app/pacientes', true);
    aoBuscar(sw, MANIFEST, evento);
    expect(await (await resposta())?.text()).toBe('SHELL');
    expect(rede).not.toHaveBeenCalled();
  });

  it('arquivo do manifest (asset com hash) sai do cache', async () => {
    const { sw, cache } = await instalado();
    cache.dados.set('/assets/main-abc.js', ok('JS-EM-CACHE'));
    const { evento, resposta } = eventoBuscar('/assets/main-abc.js', false);
    aoBuscar(sw, MANIFEST, evento);
    expect(await (await resposta())?.text()).toBe('JS-EM-CACHE');
  });

  it('o caminho do shell é /index.html', () => {
    expect(SHELL).toBe('/index.html');
  });
});

describe('página offline servida sem rede', () => {
  it('navegação fora de /app com a rede caída devolve offline.html do cache', async () => {
    const { sw, cache } = await instalado();
    cache.dados.set(PAGINA_OFFLINE, ok('OFFLINE'));
    vi.mocked(sw.fetch).mockImplementation(semRede);
    const { evento, resposta } = eventoBuscar('/termos', true);
    aoBuscar(sw, MANIFEST, evento);
    expect(await (await resposta())?.text()).toBe('OFFLINE');
  });

  it('navegação fora de /app com rede devolve a resposta da rede', async () => {
    const { sw } = await instalado();
    const { evento, resposta } = eventoBuscar('/termos', true);
    aoBuscar(sw, MANIFEST, evento);
    expect(await (await resposta())?.text()).toBe('rede:/termos');
  });

  it('navegação para /app sem o shell no cache e sem rede cai na página offline', async () => {
    const { sw, cache } = await instalado();
    cache.dados.delete('/index.html');
    cache.dados.set(PAGINA_OFFLINE, ok('OFFLINE'));
    vi.mocked(sw.fetch).mockImplementation(semRede);
    const { evento, resposta } = eventoBuscar('/app', true);
    aoBuscar(sw, MANIFEST, evento);
    expect(await (await resposta())?.text()).toBe('OFFLINE');
  });
});

describe('o que não passa pelo cache', () => {
  it('/api e métodos que não são GET seguem direto, sem respondWith', async () => {
    const { sw } = await instalado();
    const api = eventoBuscar('/api/pacientes', false);
    aoBuscar(sw, MANIFEST, api.evento);
    expect(api.resposta()).toBeUndefined();
    const post = eventoBuscar('/app/pacientes', true, 'POST');
    aoBuscar(sw, MANIFEST, post.evento);
    expect(post.resposta()).toBeUndefined();
  });
});

describe('registro do service worker no app', () => {
  it('registra /sw.js com escopo / quando o navegador suporta', async () => {
    const register = vi.fn(async () => ({}));
    await registrarSwNoApp({ register });
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('sem suporte a service worker não faz nada nem falha', async () => {
    await expect(registrarSwNoApp(undefined)).resolves.toBeUndefined();
  });
});
