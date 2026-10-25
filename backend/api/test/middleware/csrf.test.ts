import { problema } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { csrf } from '../../src/middleware/csrf.ts';
import { type VariaveisSessao, sessao } from '../../src/middleware/sessao.ts';
import { criarConta, emailSimulado, ipUnico } from '../apoio.ts';

// T51 / AUTH-17: requisição autenticada que altera dados sem o cabeçalho x-csrf-token correto
// recebe 403 sem executar a operação. GET passa sem o cabeçalho. Rotas públicas ficam fora (não
// têm sessão nem CSRF). O token correto é o que o POST /api/auth/2fa/verificar devolve (AUTH-04).

const CSRF_INVALIDO = problema('csrf_invalido', 'Token CSRF inválido');

interface Login {
  cookie: string;
  csrf: string;
}

// Login real pelas rotas: senha, código por e-mail e verificação.
async function entrar(): Promise<Login> {
  const correio = emailSimulado();
  const app = criarApp({ email: () => correio.cliente, capturarErro: () => {} });
  const conta = await criarConta();
  const pedir = (caminho: string, corpo: unknown) =>
    app.request(
      caminho,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ipUnico() },
        body: JSON.stringify(corpo),
      },
      env,
    );
  await pedir('/api/auth/entrar', { email: conta.email, senha: conta.senha });
  const codigo = /\b(\d{6})\b/.exec(correio.enviadas.at(-1)!.texto)![1]!;
  const resposta = await pedir('/api/auth/2fa/verificar', { email: conta.email, codigo });
  const cookie = /^(__Host-sid=[^;]+)/.exec(resposta.headers.get('set-cookie')!)![1]!;
  const { csrf_token } = (await resposta.json()) as { csrf_token: string };
  return { cookie, csrf: csrf_token };
}

function montar() {
  const executados: string[] = [];
  const app = new Hono<{ Bindings: Cloudflare.Env; Variables: VariaveisSessao }>();
  app.use('/dados', sessao, csrf);
  app.on(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], '/dados', (c) => {
    executados.push(c.req.method);
    return c.json({ ok: true });
  });
  const pedir = async (metodo: string, login: Login, token?: string) => {
    const resposta = await app.request(
      '/dados',
      {
        method: metodo,
        headers: {
          cookie: login.cookie,
          ...(token !== undefined ? { 'x-csrf-token': token } : {}),
        },
      },
      env,
    );
    return {
      status: resposta.status,
      tipo: resposta.headers.get('content-type'),
      corpo: (await resposta.json()) as unknown,
    };
  };
  return { pedir, executados };
}

let login: Login;
let outroLogin: Login;
beforeAll(async () => {
  login = await entrar();
  outroLogin = await entrar();
}, 30_000);

describe('escrita autenticada exige x-csrf-token correto (AUTH-17)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s sem o cabeçalho: 403 sem executar',
    async (metodo) => {
      const { pedir, executados } = montar();

      const resposta = await pedir(metodo, login);

      expect(resposta.status).toBe(403);
      expect(resposta.tipo).toBe('application/problem+json');
      expect(resposta.corpo).toEqual(CSRF_INVALIDO);
      expect(executados).toEqual([]);
    },
  );

  it.each([
    ['valor errado', 'x'.repeat(43)],
    ['valor vazio', ''],
    ['token de outra sessão', () => outroLogin.csrf],
    ['token com um caractere a mais', () => `${login.csrf}A`],
  ])('POST com %s: 403 sem executar', async (_caso, valor) => {
    const { pedir, executados } = montar();

    const resposta = await pedir('POST', login, typeof valor === 'function' ? valor() : valor);

    expect(resposta.status).toBe(403);
    expect(resposta.corpo).toEqual(CSRF_INVALIDO);
    expect(executados).toEqual([]);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s com o token devolvido no login executa',
    async (metodo) => {
      const { pedir, executados } = montar();

      const resposta = await pedir(metodo, login, login.csrf);

      expect(resposta.status).toBe(200);
      expect(executados).toEqual([metodo]);
    },
  );
});

describe('leitura não exige o cabeçalho (AUTH-17)', () => {
  it('GET sem x-csrf-token passa e executa', async () => {
    const { pedir, executados } = montar();

    const resposta = await pedir('GET', login);

    expect(resposta.status).toBe(200);
    expect(executados).toEqual(['GET']);
  });
});

describe('rotas públicas ficam fora do CSRF', () => {
  it.each([
    '/api/cadastro',
    '/api/cadastro/confirmar',
    '/api/auth/entrar',
    '/api/auth/2fa/verificar',
    '/api/auth/2fa/reenviar',
  ])('POST %s sem cookie nem x-csrf-token chega à validação do corpo', async (caminho) => {
    const app = criarApp({ email: () => emailSimulado().cliente, capturarErro: () => {} });

    const resposta = await app.request(
      caminho,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ipUnico() },
        body: '{}',
      },
      env,
    );

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao' });
  });
});
