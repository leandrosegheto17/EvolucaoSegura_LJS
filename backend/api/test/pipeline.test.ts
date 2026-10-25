import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.ts';
import { autenticada } from '../src/middleware/autenticada.ts';
import { csrf } from '../src/middleware/csrf.ts';
import { sessao } from '../src/middleware/sessao.ts';
import { transacao } from '../src/middleware/transacao.ts';
import { registrarAuditoria } from '../src/repositorios/auditoria.ts';
import { comoAdmin, criarConta, emailSimulado, ipUnico } from './apoio.ts';

// T53 / ISO-01, OPS-07, AUTH-17: pipeline de /api/* na ordem do design: cabeçalhos, rate limit
// (só rotas públicas), sessão, CSRF, plano (quando a rota pedir; ainda não há), transação com o
// usuário (BEGIN + set_config), handler e auditoria na mesma transação. Rotas públicas pulam a
// sessão e o CSRF (ver também test/middleware/csrf.test.ts). GET /api/eu devolve o usuário logado
// e o estado do perfil.

const LENTO = { timeout: 30_000 };

function montar() {
  const correio = emailSimulado();
  const capturarErro = vi.fn();
  const app = criarApp({ email: () => correio.cliente, capturarErro });
  const pedir = (
    metodo: string,
    caminho: string,
    opcoes: { corpo?: unknown; headers?: Record<string, string> } = {},
  ) =>
    app.request(
      caminho,
      {
        method: metodo,
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          ...opcoes.headers,
        },
        ...(opcoes.corpo !== undefined ? { body: JSON.stringify(opcoes.corpo) } : {}),
      },
      env,
    );
  const entrar = async () => {
    const conta = await criarConta();
    await pedir('POST', '/api/auth/entrar', { corpo: { email: conta.email, senha: conta.senha } });
    const codigo = /\b(\d{6})\b/.exec(correio.enviadas.at(-1)!.texto)![1]!;
    const resposta = await pedir('POST', '/api/auth/2fa/verificar', {
      corpo: { email: conta.email, codigo },
    });
    const cookie = /^(__Host-sid=[^;]+)/.exec(resposta.headers.get('set-cookie')!)![1]!;
    const { csrf_token } = (await resposta.json()) as { csrf_token: string };
    return { conta, cookie, csrf: csrf_token };
  };
  return { app, pedir, entrar, capturarErro };
}

describe('ordem dos middlewares de rota autenticada', () => {
  it('é sessão, CSRF e transação, nessa ordem', () => {
    expect(autenticada).toEqual([sessao, csrf, transacao]);
  });

  it('sessão vem antes do CSRF: escrita sem cookie e sem token recebe 401, não 403', async () => {
    const { pedir } = montar();

    const resposta = await pedir('POST', '/api/auth/sair');

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('cabeçalhos de segurança e no-store valem também no 401 e no 403', async () => {
    const { pedir, entrar } = montar();
    const login = await entrar();

    const semSessao = await pedir('GET', '/api/eu');
    const semCsrf = await pedir('POST', '/api/auth/sair', { headers: { cookie: login.cookie } });

    expect([semSessao.status, semCsrf.status]).toEqual([401, 403]);
    for (const resposta of [semSessao, semCsrf]) {
      expect(resposta.headers.get('Cache-Control')).toBe('no-store');
      expect(resposta.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  }, 30_000);
});

describe('rota autenticada roda dentro de comTransacao (ISO-01)', LENTO, () => {
  it('o handler recebe a transação com app.usuario_id do profissional da sessão', async () => {
    const { app, pedir, entrar } = montar();
    app.get('/api/teste/contexto', ...autenticada, async (c) => {
      const { rows } = await sql<{ usuario: string }>`
        select current_setting('app.usuario_id', true) as usuario`.execute(c.var.trx);
      return c.json({ usuario: rows[0]!.usuario });
    });
    const login = await entrar();

    const resposta = await pedir('GET', '/api/teste/contexto', {
      headers: { cookie: login.cookie },
    });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ usuario: login.conta.id });
  });

  it('erro no handler desfaz o que ele gravou, inclusive a auditoria, e responde 500', async () => {
    const { app, pedir, entrar, capturarErro } = montar();
    app.post('/api/teste/falha', ...autenticada, async (c) => {
      await registrarAuditoria(c.var.trx, {
        usuarioId: c.var.usuarioId,
        ator: c.var.usuarioId,
        acao: 'perfil.editado',
        alvoTipo: 'perfil',
      });
      throw new Error('falha depois de gravar');
    });
    const login = await entrar();

    const resposta = await pedir('POST', '/api/teste/falha', {
      headers: { cookie: login.cookie, 'x-csrf-token': login.csrf },
    });

    expect(resposta.status).toBe(500);
    expect(capturarErro).toHaveBeenCalledTimes(1);
    const eventos = await comoAdmin(
      "select 1 from audit_log where usuario_id = $1 and acao = 'perfil.editado'",
      [login.conta.id],
    );
    expect(eventos).toEqual([]);
  });
});

describe('rotas públicas pulam sessão e CSRF', () => {
  it('health responde sem cookie', async () => {
    const { pedir } = montar();

    expect((await pedir('GET', '/api/health')).status).toBe(200);
  });

  it('rota inexistente de /api continua 404, sem passar pela sessão', async () => {
    const { pedir } = montar();

    expect((await pedir('GET', '/api/nao-existe')).status).toBe(404);
  });
});

describe('GET /api/eu', LENTO, () => {
  it('devolve o usuário logado, o estado do perfil e o token CSRF da sessão', async () => {
    const { pedir, entrar } = montar();
    const login = await entrar();

    const resposta = await pedir('GET', '/api/eu', { headers: { cookie: login.cookie } });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      usuario: { id: login.conta.id, email: login.conta.email, nome: 'Ana Souza' },
      perfil: { completo: false },
      csrf_token: login.csrf,
    });
  });

  it('sem sessão responde 401', async () => {
    const { pedir } = montar();

    const resposta = await pedir('GET', '/api/eu', {
      headers: { cookie: '__Host-sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('ponta a ponta: entrar, ver /api/eu, sair e perder o acesso', async () => {
    const { pedir, entrar } = montar();
    const login = await entrar();

    expect((await pedir('GET', '/api/eu', { headers: { cookie: login.cookie } })).status).toBe(200);
    const saida = await pedir('POST', '/api/auth/sair', {
      headers: { cookie: login.cookie, 'x-csrf-token': login.csrf },
    });
    const depois = await pedir('GET', '/api/eu', { headers: { cookie: login.cookie } });

    expect(saida.status).toBe(204);
    expect(depois.status).toBe(401);
  });
});
