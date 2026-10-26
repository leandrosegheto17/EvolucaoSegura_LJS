import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CABECALHO_CSRF,
  CAMINHO_SESSAO_EXPIRADA,
  EVENTO_SESSAO_USADA,
  ErroApi,
  criarClienteApi,
  criarQueryClient,
  definirCsrf,
  lerCsrf,
  podeRepetir,
} from './api.ts';

// T56 / AUTH-17, PUB-02: cliente da API do app, portado do lib/api do legado para o prefixo /api.
// - toda escrita autenticada envia o x-csrf-token (busca o token em GET /api/eu se ainda não tem);
// - leitura (GET) e rotas públicas não enviam o cabeçalho;
// - 401 numa rota autenticada leva a /sessao-expirada; numa pública é só erro (senha ou código).
// Testado com fetch simulado.

type Resposta = { status: number; corpo?: unknown; headers?: Record<string, string> };

function fetchSimulado(...respostas: Resposta[]) {
  const fila = [...respostas];
  // A assinatura (url, init) tipa mock.calls; os valores são conferidos pelos testes.
  return vi.fn(async (url: string, init?: RequestInit) => {
    void [url, init];
    const r = fila.shift() ?? { status: 200, corpo: {} };
    const corpo = r.corpo === undefined ? null : JSON.stringify(r.corpo);
    return new Response(r.status === 204 ? null : corpo, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  });
}

const cabecalhos = (init: RequestInit | undefined) => new Headers(init?.headers);

beforeEach(() => definirCsrf(null));
afterEach(() => vi.unstubAllGlobals());

describe('prefixo /api (PUB-02)', () => {
  it('chama a API em /api + caminho, com o cookie da mesma origem', async () => {
    const fetch = fetchSimulado({ status: 200, corpo: { ok: true } });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    const dados = await api.requisitar<{ ok: boolean }>('/eu');

    expect(dados).toEqual({ ok: true });
    expect(fetch.mock.calls[0]![0]).toBe('/api/eu');
    expect(fetch.mock.calls[0]![1]!.credentials).toBe('same-origin');
  });

  it('envia o corpo como JSON', async () => {
    const fetch = fetchSimulado({ status: 202, corpo: { status: 'aceito' } });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await api.requisitar('/cadastro', { metodo: 'POST', corpo: { nome: 'Ana' }, publica: true });

    const init = fetch.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"nome":"Ana"}');
    expect(cabecalhos(init).get('content-type')).toBe('application/json');
  });

  it('204 e 202 sem corpo devolvem undefined', async () => {
    const fetch = fetchSimulado({ status: 204 }, { status: 202 });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    expect(
      await api.requisitar('/auth/recuperar/confirmar', { metodo: 'POST', publica: true }),
    ).toBe(undefined);
    expect(await api.requisitar('/auth/recuperar', { metodo: 'POST', publica: true })).toBe(
      undefined,
    );
  });
});

describe('token CSRF em toda escrita (AUTH-17)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s autenticado envia x-csrf-token',
    async (metodo) => {
      definirCsrf('token-da-sessao');
      const fetch = fetchSimulado({ status: 200, corpo: {} });
      const api = criarClienteApi({ fetch, aoExpirar: () => {} });

      await api.requisitar('/perfil', { metodo, corpo: {} });

      expect(CABECALHO_CSRF).toBe('x-csrf-token');
      expect(cabecalhos(fetch.mock.calls[0]![1]).get('x-csrf-token')).toBe('token-da-sessao');
    },
  );

  it('sem token na memória, busca em GET /api/eu antes da escrita e usa o token recebido', async () => {
    const fetch = fetchSimulado(
      { status: 200, corpo: { usuario: {}, perfil: {}, csrf_token: 'token-do-eu' } },
      { status: 204 },
    );
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await api.requisitar('/auth/sair', { metodo: 'POST' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![0]).toBe('/api/eu');
    expect(fetch.mock.calls[1]![0]).toBe('/api/auth/sair');
    expect(cabecalhos(fetch.mock.calls[1]![1]).get('x-csrf-token')).toBe('token-do-eu');
    expect(lerCsrf()).toBe('token-do-eu');
  });

  it('GET não envia o cabeçalho nem busca o token', async () => {
    const fetch = fetchSimulado({ status: 200, corpo: {} });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await api.requisitar('/pacientes');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cabecalhos(fetch.mock.calls[0]![1]).has('x-csrf-token')).toBe(false);
  });

  it('rota pública (antes da sessão) não envia o cabeçalho nem busca o token', async () => {
    definirCsrf('token-velho');
    const fetch = fetchSimulado({ status: 202, corpo: { status: '2fa_required' } });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await api.requisitar('/auth/entrar', { metodo: 'POST', corpo: {}, publica: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cabecalhos(fetch.mock.calls[0]![1]).has('x-csrf-token')).toBe(false);
  });

  it('carregarCsrf guarda o token de GET /api/eu', async () => {
    const fetch = fetchSimulado({ status: 200, corpo: { csrf_token: 'abc' } });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await api.carregarCsrf();

    expect(lerCsrf()).toBe('abc');
  });
});

describe('401 leva a /sessao-expirada', () => {
  const PROBLEMA_401 = {
    tipo: 'about:blank',
    titulo: 'Não autorizado',
    status: 401,
    codigo: 'credenciais_invalidas',
  };

  it('401 numa rota autenticada chama o fim de sessão, esquece o token e lança o erro', async () => {
    definirCsrf('token-da-sessao');
    const aoExpirar = vi.fn();
    const fetch = fetchSimulado({ status: 401, corpo: PROBLEMA_401 });
    const api = criarClienteApi({ fetch, aoExpirar });

    await expect(api.requisitar('/pacientes')).rejects.toMatchObject({ status: 401 });

    expect(aoExpirar).toHaveBeenCalledTimes(1);
    expect(lerCsrf()).toBeNull();
  });

  it('por padrão, navega para /sessao-expirada', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/app', assign });
    const fetch = fetchSimulado({ status: 401, corpo: PROBLEMA_401 });
    const api = criarClienteApi({ fetch });

    await expect(api.requisitar('/eu')).rejects.toBeInstanceOf(ErroApi);

    expect(CAMINHO_SESSAO_EXPIRADA).toBe('/sessao-expirada');
    expect(assign).toHaveBeenCalledWith('/sessao-expirada');
  });

  it('401 ao buscar o token antes da escrita também leva ao fim de sessão', async () => {
    const aoExpirar = vi.fn();
    const fetch = fetchSimulado({ status: 401, corpo: PROBLEMA_401 });
    const api = criarClienteApi({ fetch, aoExpirar });

    await expect(api.requisitar('/perfil', { metodo: 'PUT', corpo: {} })).rejects.toMatchObject({
      status: 401,
    });

    expect(aoExpirar).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('401 numa rota pública (senha ou código errado) não é sessão expirada', async () => {
    const aoExpirar = vi.fn();
    const fetch = fetchSimulado({ status: 401, corpo: PROBLEMA_401 });
    const api = criarClienteApi({ fetch, aoExpirar });

    await expect(
      api.requisitar('/auth/entrar', { metodo: 'POST', corpo: {}, publica: true }),
    ).rejects.toMatchObject({ status: 401, codigo: 'credenciais_invalidas' });

    expect(aoExpirar).not.toHaveBeenCalled();
  });
});

describe('erros da API (problem+json)', () => {
  it('lê o código, o motivo e os campos do contrato', async () => {
    const fetch = fetchSimulado({
      status: 422,
      corpo: {
        tipo: 'about:blank',
        titulo: 'Senha fora da política',
        status: 422,
        codigo: 'senha_fora_da_politica',
        motivo: 'comum',
      },
    });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    const erro = await api
      .requisitar('/cadastro', { metodo: 'POST', corpo: {}, publica: true })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).toMatchObject({ status: 422, codigo: 'senha_fora_da_politica', motivo: 'comum' });
  });

  it('lê os campos do erro de validação', async () => {
    const fetch = fetchSimulado({
      status: 422,
      corpo: {
        tipo: 'about:blank',
        titulo: 'x',
        status: 422,
        codigo: 'validacao',
        campos: ['email'],
      },
    });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await expect(
      api.requisitar('/cadastro', { metodo: 'POST', corpo: {}, publica: true }),
    ).rejects.toMatchObject({ codigo: 'validacao', campos: ['email'] });
  });

  it('429 traz o Retry-After em segundos', async () => {
    const fetch = fetchSimulado({
      status: 429,
      corpo: { tipo: 'about:blank', titulo: 'x', status: 429, codigo: 'muitas_tentativas' },
      headers: { 'Retry-After': '840' },
    });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await expect(
      api.requisitar('/auth/entrar', { metodo: 'POST', corpo: {}, publica: true }),
    ).rejects.toMatchObject({ status: 429, retryAfter: 840 });
  });

  it('corpo que não é JSON vira o código genérico "erro"', async () => {
    const fetch = vi.fn(async () => new Response('<html>', { status: 502 }));
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await expect(api.requisitar('/eu')).rejects.toMatchObject({ status: 502, codigo: 'erro' });
  });
});

describe('repetição no TanStack Query', () => {
  it('não repete erro 4xx (inclui 401 e 422)', () => {
    expect(podeRepetir(0, new ErroApi(401, 'credenciais_invalidas'))).toBe(false);
    expect(podeRepetir(0, new ErroApi(422, 'validacao'))).toBe(false);
  });

  it('repete até 2 vezes falha de rede ou 5xx', () => {
    expect(podeRepetir(0, new ErroApi(503, 'mail_unavailable'))).toBe(true);
    expect(podeRepetir(1, new TypeError('rede'))).toBe(true);
    expect(podeRepetir(2, new TypeError('rede'))).toBe(false);
  });

  it('o QueryClient do app usa essa regra e não repete escrita', () => {
    const padrao = criarQueryClient().getDefaultOptions();
    expect(padrao.queries?.retry).toBe(podeRepetir);
    expect(padrao.mutations?.retry).toBe(false);
  });
});

// T60 / AUTH-18: a inatividade do servidor conta desde a última requisição autenticada; o cliente
// avisa o app a cada resposta autenticada que não seja 401, para o aviso de inatividade recomeçar.
describe('aviso de sessão usada (AUTH-18)', () => {
  function ouvir() {
    const ouvinte = vi.fn();
    window.addEventListener(EVENTO_SESSAO_USADA, ouvinte);
    return {
      ouvinte,
      parar: () => window.removeEventListener(EVENTO_SESSAO_USADA, ouvinte),
    };
  }

  it.each([200, 204, 404, 422])('resposta %i de rota autenticada avisa', async (status) => {
    const { ouvinte, parar } = ouvir();
    const fetch = fetchSimulado({ status, corpo: status === 204 ? undefined : {} });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await api.requisitar('/pacientes').catch(() => undefined);

    expect(ouvinte).toHaveBeenCalledTimes(1);
    parar();
  });

  it('401 não avisa (a sessão já acabou)', async () => {
    const { ouvinte, parar } = ouvir();
    const fetch = fetchSimulado({ status: 401, corpo: {} });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await api.requisitar('/pacientes').catch(() => undefined);

    expect(ouvinte).not.toHaveBeenCalled();
    parar();
  });

  it('rota pública não avisa (não usa a sessão)', async () => {
    const { ouvinte, parar } = ouvir();
    const fetch = fetchSimulado({ status: 202, corpo: {} });
    const api = criarClienteApi({ fetch, aoExpirar: () => {} });

    await api.requisitar('/auth/recuperar', { metodo: 'POST', publica: true });

    expect(ouvinte).not.toHaveBeenCalled();
    parar();
  });
});
