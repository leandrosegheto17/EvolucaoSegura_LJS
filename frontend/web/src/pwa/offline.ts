// PUB-03 (T184): precache do shell e página offline, no service worker (sw.ts).
// - install: guarda no cache as entradas do manifest do build (injetado pelo vite-plugin-pwa:
//   index.html, offline.html e os arquivos com hash) e ativa sem esperar (skipWaiting).
// - activate: apaga do cache o que saiu do manifest e assume as abas abertas.
// - fetch (só GET na mesma origem, nunca /api): arquivo do manifest sai do cache; navegação para
//   /app/... devolve o shell (index.html) do cache; navegação fora de /app vai à rede e, se ela
//   cair, devolve /offline.html. Sem o shell no cache e sem rede, também cai na página offline.
// PREMISSA: o app depende todo da API, então o shell offline só mostra as telas com o erro de rede
// de cada uma; não há cache de dados (dado clínico não fica no cache do navegador, por segurança).

export interface EntradaPrecache {
  url: string;
  revision: string | null;
}

export const SHELL = '/index.html';
export const PAGINA_OFFLINE = '/offline.html';
const NOME_CACHE = 'es-precache';

interface CacheMin {
  put(req: string | Request, r: Response): Promise<void>;
  match(req: string | Request): Promise<Response | undefined>;
  keys(): Promise<readonly Request[]>;
  delete(req: string | Request): Promise<boolean>;
}

export interface EscopoOffline {
  location: { origin: string };
  caches: { open(nome: string): Promise<CacheMin> };
  fetch(req: string | Request): Promise<Response>;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(tipo: 'install' | 'activate' | 'fetch', fn: (evento: never) => void): void;
}

interface EventoEspera {
  waitUntil(promessa: Promise<unknown>): void;
}

export interface EventoBuscar {
  request: Request;
  respondWith(resposta: Promise<Response>): void;
}

// T203: o Worker responde /index.html e /offline.html com 307 para a URL sem ".html", e o fetch
// devolve a resposta final com redirected = true. O navegador recusa resposta redirecionada para
// atender navegação; por isso a resposta é refeita (mesmo corpo, status e cabeçalhos) antes de ir
// para o cache e antes de atender uma navegação (cobre também cache de versão anterior).
async function semRedirecionamento(r: Response): Promise<Response> {
  if (!r.redirected) return r;
  return new Response(await r.arrayBuffer(), {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
  });
}

// O manifest do build traz URLs relativas ("index.html"); o cache usa caminhos absolutos.
const caminho = (url: string) => `/${(url.split('?')[0] ?? url).replace(/^\//, '')}`;

export function aoInstalar(sw: EscopoOffline, manifest: EntradaPrecache[], evento: EventoEspera) {
  evento.waitUntil(
    (async () => {
      const cache = await sw.caches.open(NOME_CACHE);
      for (const entrada of manifest) {
        const url = caminho(entrada.url);
        const resposta = await sw.fetch(
          new Request(new URL(url, sw.location.origin), { cache: 'reload' }),
        );
        if (!resposta.ok) throw new Error(`precache falhou em ${url}: ${resposta.status}`);
        await cache.put(url, await semRedirecionamento(resposta));
      }
      await sw.skipWaiting();
    })(),
  );
}

export function aoAtivar(sw: EscopoOffline, manifest: EntradaPrecache[], evento: EventoEspera) {
  const vigentes = new Set(manifest.map((e) => caminho(e.url)));
  evento.waitUntil(
    (async () => {
      const cache = await sw.caches.open(NOME_CACHE);
      for (const req of await cache.keys()) {
        if (!vigentes.has(new URL(req.url).pathname)) await cache.delete(req);
      }
      await sw.clients.claim();
    })(),
  );
}

async function daRedeOuOffline(sw: EscopoOffline, req: Request): Promise<Response> {
  try {
    return await sw.fetch(req);
  } catch {
    const cache = await sw.caches.open(NOME_CACHE);
    const offline = await cache.match(PAGINA_OFFLINE);
    return offline ? semRedirecionamento(offline) : Response.error();
  }
}

export function aoBuscar(sw: EscopoOffline, manifest: EntradaPrecache[], evento: EventoBuscar) {
  const req = evento.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    const doApp = url.pathname === '/app' || url.pathname.startsWith('/app/');
    evento.respondWith(
      (async () => {
        if (doApp) {
          const cache = await sw.caches.open(NOME_CACHE);
          const shell = await cache.match(SHELL);
          if (shell) return semRedirecionamento(shell);
        }
        return daRedeOuOffline(sw, req);
      })(),
    );
    return;
  }

  if (manifest.some((e) => caminho(e.url) === url.pathname)) {
    evento.respondWith(
      (async () => {
        const cache = await sw.caches.open(NOME_CACHE);
        return (await cache.match(url.pathname)) ?? sw.fetch(req);
      })(),
    );
  }
}

export function registrarOffline(sw: EscopoOffline, manifest: EntradaPrecache[]): void {
  sw.addEventListener('install', (e: EventoEspera) => aoInstalar(sw, manifest, e));
  sw.addEventListener('activate', (e: EventoEspera) => aoAtivar(sw, manifest, e));
  sw.addEventListener('fetch', (e: EventoBuscar) => aoBuscar(sw, manifest, e));
}

// No app (main.tsx): registra o service worker já na abertura, para o precache valer também
// antes de a pessoa ligar o push (a tela de push registra o mesmo /sw.js).
export async function registrarSwNoApp(
  contenedor: { register(url: string, opcoes: { scope: string }): Promise<unknown> } | undefined,
): Promise<void> {
  if (!contenedor) return;
  try {
    await contenedor.register('/sw.js', { scope: '/' });
  } catch {
    // Sem service worker o app segue funcionando, só sem o modo offline.
  }
}
