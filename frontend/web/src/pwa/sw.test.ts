import { describe, expect, it, vi } from 'vitest';
import {
  type EscopoSw,
  aoClicarNotificacao,
  aoReceberPush,
  destinoDoClique,
  lerMensagem,
  registrarHandlers,
} from './sw.ts';

// T147 / PUSH-01, PUSH-08: service worker do push. Critérios: o clique abre a tela relacionada
// (sessão, Início ou Meu plano) e há teste do roteamento do clique. A API manda a mensagem
// cifrada como JSON {titulo, corpo, url} (T176): sessão próxima abre /app/agenda (não há tela
// própria de sessão, T144), evolução pendente abre /app (Início, T145), cobrança e trial abrem
// /app/plano (Meu plano, T146 e T178).
// O escopo do service worker é simulado: registration.showNotification, clients e waitUntil.

const ORIGEM = 'https://app.evolucaosegura.com.br';

function dadosPush(valor: unknown) {
  return { json: () => (typeof valor === 'string' ? JSON.parse(valor) : valor) };
}

function janela(url: string, opcoes: { navegarFalha?: boolean } = {}) {
  const j = {
    url,
    focused: false,
    focus: vi.fn(async () => {
      j.focused = true;
      return j;
    }),
    navigate: vi.fn(async (destino: string) => {
      if (opcoes.navegarFalha) throw new TypeError('não controlada');
      j.url = new URL(destino, ORIGEM).href;
      return j;
    }),
  };
  return j;
}

function escopo(janelas: ReturnType<typeof janela>[] = []) {
  const escutas: Record<string, (evento: unknown) => void> = {};
  const sw = {
    location: { origin: ORIGEM },
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: {
      matchAll: vi.fn(async () => janelas),
      openWindow: vi.fn(async () => null),
    },
    addEventListener: vi.fn((tipo: string, fn: (evento: unknown) => void) => {
      escutas[tipo] = fn;
    }),
  };
  return { sw: sw as unknown as EscopoSw, bruto: sw, escutas };
}

function eventoClique(url: unknown) {
  const esperas: Promise<unknown>[] = [];
  return {
    evento: {
      notification: { data: { url }, close: vi.fn() },
      waitUntil: (p: Promise<unknown>) => esperas.push(p),
    },
    esperar: () => Promise.all(esperas),
  };
}

describe('roteamento do clique (PUSH-08)', () => {
  it.each([
    ['/app/agenda', '/app/agenda'],
    ['/app', '/app'],
    ['/app/plano', '/app/plano'],
  ])('a url %s da mensagem abre %s', (url, esperado) => {
    expect(destinoDoClique(url, ORIGEM)).toBe(esperado);
  });

  it('mantém consulta e âncora de uma tela do app', () => {
    expect(destinoDoClique('/app/agenda?dia=2026-11-10#s1', ORIGEM)).toBe(
      '/app/agenda?dia=2026-11-10#s1',
    );
  });

  it('url completa da mesma origem vira caminho', () => {
    expect(destinoDoClique(`${ORIGEM}/app/plano`, ORIGEM)).toBe('/app/plano');
  });

  it.each([
    ['ausente', undefined],
    ['não texto', 42],
    ['vazia', ''],
    ['de outra origem', 'https://golpe.exemplo.com/app/plano'],
    ['protocolo relativo', '//golpe.exemplo.com/app'],
    ['javascript:', 'javascript:alert(1)'],
    ['fora do app', '/entrar'],
    ['prefixo parecido', '/application'],
    ['com barra invertida', '/\\golpe.exemplo.com'],
    ['subindo de pasta', '/app/../entrar'],
  ])('url %s abre o Início', (_rotulo, url) => {
    expect(destinoDoClique(url, ORIGEM)).toBe('/app');
  });
});

describe('leitura da mensagem', () => {
  it('lê título, corpo e url do JSON cifrado pela API', () => {
    expect(
      lerMensagem(dadosPush({ titulo: 'Sessão próxima', corpo: 'Às 14:00.', url: '/app/agenda' })),
    ).toEqual({ titulo: 'Sessão próxima', corpo: 'Às 14:00.', url: '/app/agenda' });
  });

  it('push sem dados, com JSON inválido ou campos errados mostra o aviso genérico do Início', () => {
    const generico = { titulo: 'Evolução Segura', corpo: '', url: '/app' };
    expect(lerMensagem(null)).toEqual(generico);
    expect(
      lerMensagem({
        json: () => {
          throw new SyntaxError('x');
        },
      }),
    ).toEqual(generico);
    expect(lerMensagem(dadosPush({ titulo: 1, corpo: null, url: {} }))).toEqual(generico);
  });
});

describe('evento push', () => {
  it('mostra a notificação com o corpo e guarda o destino do clique', async () => {
    const { sw, bruto } = escopo();
    const esperas: Promise<unknown>[] = [];
    aoReceberPush(sw, {
      data: dadosPush({ titulo: 'Nova cobrança', corpo: 'Pague com Pix.', url: '/app/plano' }),
      waitUntil: (p) => esperas.push(p),
    });
    await Promise.all(esperas);
    expect(esperas).toHaveLength(1);
    expect(bruto.registration.showNotification).toHaveBeenCalledWith('Nova cobrança', {
      body: 'Pague com Pix.',
      data: { url: '/app/plano' },
    });
  });
});

describe('evento notificationclick: abre a tela relacionada (PUSH-08)', () => {
  it('sem janela aberta, abre uma nova na tela da mensagem', async () => {
    const { sw, bruto } = escopo();
    const { evento, esperar } = eventoClique('/app/plano');
    aoClicarNotificacao(sw, evento);
    await esperar();
    expect(evento.notification.close).toHaveBeenCalled();
    expect(bruto.clients.openWindow).toHaveBeenCalledWith('/app/plano');
  });

  it('com o app aberto, leva a janela à tela e a põe em foco, sem abrir outra', async () => {
    const aberta = janela(`${ORIGEM}/app/pacientes`);
    const { sw, bruto } = escopo([aberta]);
    const { evento, esperar } = eventoClique('/app/agenda');
    aoClicarNotificacao(sw, evento);
    await esperar();
    expect(aberta.navigate).toHaveBeenCalledWith('/app/agenda');
    expect(aberta.focus).toHaveBeenCalled();
    expect(bruto.clients.openWindow).not.toHaveBeenCalled();
    expect(bruto.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
  });

  it('janela de outra origem não é reaproveitada', async () => {
    const outra = janela('https://outro.exemplo.com/app');
    const { sw, bruto } = escopo([outra]);
    const { evento, esperar } = eventoClique('/app');
    aoClicarNotificacao(sw, evento);
    await esperar();
    expect(outra.navigate).not.toHaveBeenCalled();
    expect(bruto.clients.openWindow).toHaveBeenCalledWith('/app');
  });

  it('se a janela aberta não puder navegar, abre uma nova', async () => {
    const aberta = janela(`${ORIGEM}/app`, { navegarFalha: true });
    const { sw, bruto } = escopo([aberta]);
    const { evento, esperar } = eventoClique('/app/plano');
    aoClicarNotificacao(sw, evento);
    await esperar();
    expect(bruto.clients.openWindow).toHaveBeenCalledWith('/app/plano');
  });

  it('destino fora do app abre o Início', async () => {
    const { sw, bruto } = escopo();
    const { evento, esperar } = eventoClique('https://golpe.exemplo.com');
    aoClicarNotificacao(sw, evento);
    await esperar();
    expect(bruto.clients.openWindow).toHaveBeenCalledWith('/app');
  });
});

describe('registro dos handlers', () => {
  it('escuta push e notificationclick no escopo do service worker', async () => {
    const { sw, bruto, escutas } = escopo();
    registrarHandlers(sw);
    expect(Object.keys(escutas).sort()).toEqual(['notificationclick', 'push']);
    const { evento, esperar } = eventoClique('/app/agenda');
    escutas['notificationclick']!(evento);
    await esperar();
    expect(bruto.clients.openWindow).toHaveBeenCalledWith('/app/agenda');
  });
});
