import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { PushDispositivo, chaveParaBytes } from './push.tsx';

// T179 / PUSH-01, PERF-08: interruptor do push por dispositivo nas Configurações. Critérios:
// o interruptor ativa e desativa o push do dispositivo; permissão negada é tratada.
// Ativar: pede a permissão, registra o service worker (/sw.js, T147), assina no PushManager com a
// chave pública VAPID (GET /api/push/chave) e guarda a assinatura (POST /api/push/assinatura,
// T143). Desativar: remove no servidor (DELETE) e cancela a assinatura no navegador.
// O navegador é simulado: Notification, PushManager e navigator.serviceWorker.

const CHAVE = 'BOr4H2Cb1u2yP4yq8bBFq3vB9Yb3pU9n5B0kQ0yVq3C8';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const JSON_ASSINATURA = {
  endpoint: ENDPOINT,
  expirationTime: null,
  keys: { p256dh: 'BNcRdreALRFX', auth: 'tBHItJI5svbpez7K' },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  definirCsrf(null);
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const problema = (status: number, codigo: string) =>
  new Response(JSON.stringify({ tipo: 'about:blank', titulo: codigo, status, codigo }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });

function api(over: Record<string, () => Response> = {}) {
  const calls: { key: string; body?: string }[] = [];
  const routes: Record<string, () => Response> = {
    'GET /api/push/chave': () => json({ chave_publica: CHAVE }),
    'GET /api/eu': () => json({ perfil: { completo: true }, csrf_token: 't' }),
    'POST /api/push/assinatura': () => new Response(null, { status: 204 }),
    'DELETE /api/push/assinatura': () => new Response(null, { status: 204 }),
    ...over,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push({ key, body: init?.body as string });
      const h = routes[key];
      if (!h) throw new Error(`sem mock: ${key}`);
      return h();
    }),
  );
  return calls;
}

interface OpcoesNavegador {
  permissao?: NotificationPermission;
  resposta?: NotificationPermission;
  assinado?: boolean;
  semSuporte?: boolean;
}

function navegador({
  permissao = 'default',
  resposta = 'granted',
  assinado = false,
  semSuporte = false,
}: OpcoesNavegador = {}) {
  const assinatura = {
    endpoint: ENDPOINT,
    toJSON: () => JSON_ASSINATURA,
    unsubscribe: vi.fn(async () => true),
  };
  let atual: typeof assinatura | null = assinado ? assinatura : null;
  const pushManager = {
    getSubscription: vi.fn(async () => atual),
    subscribe: vi.fn(async () => {
      atual = assinatura;
      return assinatura;
    }),
  };
  assinatura.unsubscribe.mockImplementation(async () => {
    atual = null;
    return true;
  });
  const registro = { pushManager };
  const serviceWorker = {
    register: vi.fn(async () => registro),
    getRegistration: vi.fn(async () => (assinado ? registro : undefined)),
    ready: Promise.resolve(registro),
  };
  const Notificacao = {
    permission: permissao,
    requestPermission: vi.fn(async () => {
      Notificacao.permission = resposta;
      return resposta;
    }),
  };
  if (!semSuporte) {
    vi.stubGlobal('Notification', Notificacao);
    vi.stubGlobal('PushManager', function PushManager() {});
    Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  } else {
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
  }
  return { assinatura, pushManager, serviceWorker, Notificacao };
}

const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PushDispositivo />
    </QueryClientProvider>,
  );

const interruptor = () => screen.findByRole('switch', { name: /Notificações neste dispositivo/ });

describe('interruptor ativa e desativa o push do dispositivo (PUSH-01, PERF-08)', () => {
  it('desligado quando o dispositivo não tem assinatura; acessível', async () => {
    api();
    navegador();
    const { container } = setup();
    const sw = (await interruptor()) as HTMLInputElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    expect(sw.checked).toBe(false);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('ativar pede permissão, registra o service worker, assina com a chave e guarda no servidor', async () => {
    const calls = api();
    const nav = navegador();
    setup();
    const sw = (await interruptor()) as HTMLInputElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    await userEvent.click(sw);
    await waitFor(() => expect(sw.checked).toBe(true));
    expect(nav.Notificacao.requestPermission).toHaveBeenCalled();
    expect(nav.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(nav.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: chaveParaBytes(CHAVE),
    });
    expect(calls.find((c) => c.key === 'POST /api/push/assinatura')?.body).toBe(
      JSON.stringify(JSON_ASSINATURA),
    );
    expect(await screen.findByText('Notificações ativadas neste dispositivo.')).toBeTruthy();
  });

  it('ligado quando o dispositivo já tem assinatura; desativar remove no servidor e no navegador', async () => {
    const calls = api();
    const nav = navegador({ permissao: 'granted', assinado: true });
    setup();
    const sw = (await interruptor()) as HTMLInputElement;
    await waitFor(() => expect(sw.checked).toBe(true));
    await userEvent.click(sw);
    await waitFor(() => expect(sw.checked).toBe(false));
    expect(calls.find((c) => c.key === 'DELETE /api/push/assinatura')?.body).toBe(
      JSON.stringify({ endpoint: ENDPOINT }),
    );
    expect(nav.assinatura.unsubscribe).toHaveBeenCalled();
    expect(await screen.findByText('Notificações desativadas neste dispositivo.')).toBeTruthy();
  });

  it('falha ao guardar no servidor: avisa, cancela a assinatura nova e fica desligado', async () => {
    api({ 'POST /api/push/assinatura': () => problema(500, 'erro') });
    const nav = navegador();
    setup();
    const sw = (await interruptor()) as HTMLInputElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    await userEvent.click(sw);
    expect(
      await screen.findByText('Não foi possível ativar as notificações agora. Tente novamente.'),
    ).toBeTruthy();
    expect(sw.checked).toBe(false);
    expect(nav.assinatura.unsubscribe).toHaveBeenCalled();
  });

  it('dispositivo já ligado a outra conta (409): avisa e não mexe na assinatura dela', async () => {
    api({ 'POST /api/push/assinatura': () => problema(409, 'endpoint_em_uso') });
    const nav = navegador();
    setup();
    const sw = (await interruptor()) as HTMLInputElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    await userEvent.click(sw);
    expect(
      await screen.findByText(
        'Este dispositivo já recebe notificações de outra conta. Desative nela primeiro.',
      ),
    ).toBeTruthy();
    expect(sw.checked).toBe(false);
    expect(nav.assinatura.unsubscribe).not.toHaveBeenCalled();
  });

  it('falha ao desativar no servidor: avisa e continua ligado', async () => {
    api({ 'DELETE /api/push/assinatura': () => problema(500, 'erro') });
    const nav = navegador({ permissao: 'granted', assinado: true });
    setup();
    const sw = (await interruptor()) as HTMLInputElement;
    await waitFor(() => expect(sw.checked).toBe(true));
    await userEvent.click(sw);
    expect(
      await screen.findByText('Não foi possível desativar as notificações agora. Tente novamente.'),
    ).toBeTruthy();
    expect(sw.checked).toBe(true);
    expect(nav.assinatura.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('permissão negada (PUSH-01)', () => {
  it('negada ao pedir: não assina, não grava e explica como liberar', async () => {
    const calls = api();
    const nav = navegador({ resposta: 'denied' });
    setup();
    const sw = (await interruptor()) as HTMLInputElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    await userEvent.click(sw);
    expect(
      await screen.findByText(
        'As notificações estão bloqueadas neste navegador. Para ativar, libere nas configurações do navegador.',
      ),
    ).toBeTruthy();
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(true);
    expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls.some((c) => c.key === 'POST /api/push/assinatura')).toBe(false);
  });

  it('já negada antes: interruptor desligado e bloqueado, com a explicação', async () => {
    api();
    const nav = navegador({ permissao: 'denied' });
    setup();
    const sw = (await interruptor()) as HTMLInputElement;
    expect(
      await screen.findByText(
        'As notificações estão bloqueadas neste navegador. Para ativar, libere nas configurações do navegador.',
      ),
    ).toBeTruthy();
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(true);
    expect(nav.Notificacao.requestPermission).not.toHaveBeenCalled();
  });

  it('pedido fechado sem resposta: fica desligado e pode tentar de novo', async () => {
    api();
    const nav = navegador({ resposta: 'default' });
    setup();
    const sw = (await interruptor()) as HTMLInputElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    await userEvent.click(sw);
    expect(
      await screen.findByText('Permissão não concedida. Toque de novo para tentar.'),
    ).toBeTruthy();
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(false);
    expect(nav.pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe('sem como receber push', () => {
  it('navegador sem suporte: explica e não mostra o interruptor nem chama a API', async () => {
    const calls = api();
    navegador({ semSuporte: true });
    setup();
    expect(
      await screen.findByText(
        'Este navegador não recebe notificações. No iPhone e no iPad, adicione o app à Tela de Início e abra por lá.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('push desligado no servidor (sem chave): interruptor bloqueado, com aviso', async () => {
    api({ 'GET /api/push/chave': () => json({ chave_publica: null }) });
    navegador();
    setup();
    expect(await screen.findByText('As notificações estão indisponíveis no momento.')).toBeTruthy();
    expect(((await interruptor()) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('chaveParaBytes', () => {
  it('decodifica a chave base64url em bytes', () => {
    expect(Array.from(chaveParaBytes('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });
});
