// PUSH-01, PUSH-08 (ADR-011): service worker do app, servido em /sw.js (escopo /). Por ora só o
// push; o precache do shell e a página offline entram na T184.
// - push: a API manda a mensagem cifrada como JSON {titulo, corpo, url} (T176); o handler mostra
//   a notificação e guarda a url no `data`. Push sem dados ou com JSON inválido mostra um aviso
//   genérico que abre o Início (o navegador exige mostrar algo a cada push, userVisibleOnly).
// - notificationclick: fecha a notificação e abre a tela relacionada: sessão próxima vai à agenda
//   (/app/agenda, não há tela própria de sessão), evolução pendente ao Início (/app), cobrança e
//   trial ao Meu plano (/app/plano). Só caminhos do app na mesma origem; qualquer outro destino
//   (outra origem, javascript:, fora de /app) abre o Início. Com o app já aberto numa janela,
//   leva essa janela à tela e a põe em foco; se ela não puder navegar, abre outra.
// Arquivo sem imports (vira um único sw.js no build) e com os tipos do escopo do service worker
// declarados aqui: o tsconfig do web usa a lib DOM, que não traz a WebWorker.

export interface MensagemPush {
  titulo: string;
  corpo: string;
  url: string;
}

interface JanelaCliente {
  url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
}

export interface EscopoSw {
  location: { origin: string };
  registration: {
    showNotification(
      titulo: string,
      opcoes: { body: string; data: { url: string } },
    ): Promise<void>;
  };
  clients: {
    matchAll(opcoes: { type: 'window'; includeUncontrolled: boolean }): Promise<JanelaCliente[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(tipo: 'push' | 'notificationclick', fn: (evento: never) => void): void;
}

interface EventoEspera {
  waitUntil(promessa: Promise<unknown>): void;
}

export interface EventoPush extends EventoEspera {
  data: { json(): unknown } | null;
}

export interface EventoCliqueNotificacao extends EventoEspera {
  notification: { data: unknown; close(): void };
}

export const INICIO = '/app';
const MENSAGEM_GENERICA: MensagemPush = { titulo: 'Evolução Segura', corpo: '', url: INICIO };

// Caminho do app (/app ou /app/...) na mesma origem, com consulta e âncora; senão, o Início.
export function destinoDoClique(url: unknown, origem: string): string {
  if (typeof url !== 'string' || url === '') return INICIO;
  let alvo: URL;
  try {
    alvo = new URL(url, origem);
  } catch {
    return INICIO;
  }
  if (alvo.origin !== origem) return INICIO;
  if (alvo.pathname !== INICIO && !alvo.pathname.startsWith(`${INICIO}/`)) return INICIO;
  return `${alvo.pathname}${alvo.search}${alvo.hash}`;
}

export function lerMensagem(dados: EventoPush['data']): MensagemPush {
  if (dados === null) return MENSAGEM_GENERICA;
  let lido: unknown;
  try {
    lido = dados.json();
  } catch {
    return MENSAGEM_GENERICA;
  }
  if (typeof lido !== 'object' || lido === null) return MENSAGEM_GENERICA;
  const { titulo, corpo, url } = lido as Record<string, unknown>;
  if (typeof titulo !== 'string' || typeof corpo !== 'string' || typeof url !== 'string')
    return MENSAGEM_GENERICA;
  return { titulo, corpo, url };
}

export function aoReceberPush(sw: EscopoSw, evento: EventoPush): void {
  const { titulo, corpo, url } = lerMensagem(evento.data);
  evento.waitUntil(sw.registration.showNotification(titulo, { body: corpo, data: { url } }));
}

async function abrir(sw: EscopoSw, destino: string): Promise<void> {
  const janelas = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const doApp = janelas.find((j) => {
    try {
      return new URL(j.url).origin === sw.location.origin;
    } catch {
      return false;
    }
  });
  if (doApp) {
    try {
      await doApp.navigate(destino);
      await doApp.focus();
      return;
    } catch {
      // Janela que o service worker não controla não navega: abre outra.
    }
  }
  await sw.clients.openWindow(destino);
}

export function aoClicarNotificacao(sw: EscopoSw, evento: EventoCliqueNotificacao): void {
  evento.notification.close();
  const dados = evento.notification.data as { url?: unknown } | null | undefined;
  evento.waitUntil(abrir(sw, destinoDoClique(dados?.url, sw.location.origin)));
}

export function registrarHandlers(sw: EscopoSw): void {
  sw.addEventListener('push', (evento: EventoPush) => aoReceberPush(sw, evento));
  sw.addEventListener('notificationclick', (evento: EventoCliqueNotificacao) =>
    aoClicarNotificacao(sw, evento),
  );
}

// No navegador, só dentro do escopo do service worker (no app e nos testes, nada se registra).
declare const ServiceWorkerGlobalScope: { new (): unknown } | undefined;
if (
  typeof ServiceWorkerGlobalScope !== 'undefined' &&
  globalThis instanceof ServiceWorkerGlobalScope
)
  registrarHandlers(globalThis as unknown as EscopoSw);
