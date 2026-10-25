import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, criarConta, emailSimulado, ipUnico, sha256 } from '../apoio.ts';

// T52 / AUTH-16, AUD-04: POST /api/auth/sair encerra a sessão (UPDATE, sem DELETE), limpa o
// cookie com Max-Age=0, responde 204 e audita auth.logout. Como toda escrita autenticada, exige
// sessão válida (401) e o x-csrf-token (403, AUTH-17).

const LENTO = { timeout: 30_000 };

function montar() {
  const correio = emailSimulado();
  const app = criarApp({ email: () => correio.cliente, capturarErro: () => {} });
  const pedir = (caminho: string, opcoes: { corpo?: unknown; headers?: Record<string, string> }) =>
    app.request(
      caminho,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0',
          ...opcoes.headers,
        },
        ...(opcoes.corpo !== undefined ? { body: JSON.stringify(opcoes.corpo) } : {}),
      },
      env,
    );
  const entrar = async () => {
    const conta = await criarConta();
    await pedir('/api/auth/entrar', { corpo: { email: conta.email, senha: conta.senha } });
    const codigo = /\b(\d{6})\b/.exec(correio.enviadas.at(-1)!.texto)![1]!;
    const resposta = await pedir('/api/auth/2fa/verificar', {
      corpo: { email: conta.email, codigo },
    });
    const sid = /^__Host-sid=([^;]+)/.exec(resposta.headers.get('set-cookie')!)![1]!;
    const { csrf_token } = (await resposta.json()) as { csrf_token: string };
    return { conta, sid, cookie: `__Host-sid=${sid}`, csrf: csrf_token };
  };
  const sair = (headers: Record<string, string>) => pedir('/api/auth/sair', { headers });
  return { entrar, sair };
}

const sessaoDoSid = async (sid: string) =>
  (
    await comoAdmin<{ id: string; encerrada_em: Date | null }>(
      'select id, encerrada_em from sessao where token_hash = $1',
      [await sha256(sid)],
    )
  )[0];

describe('sair (AUTH-16)', LENTO, () => {
  it('responde 204 e limpa o cookie com Max-Age=0', async () => {
    const { entrar, sair } = montar();
    const login = await entrar();

    const resposta = await sair({ cookie: login.cookie, 'x-csrf-token': login.csrf });

    expect(resposta.status).toBe(204);
    expect(await resposta.text()).toBe('');
    const atributos = resposta.headers
      .get('set-cookie')!
      .split(';')
      .map((a) => a.trim().toLowerCase());
    expect(atributos[0]).toBe('__host-sid=');
    expect(atributos).toContain('max-age=0');
    expect(atributos).toContain('path=/');
    expect(atributos).toContain('secure');
    expect(atributos).toContain('httponly');
  });

  it('encerra a sessão sem apagar a linha: a requisição seguinte com o mesmo cookie recebe 401', async () => {
    const { entrar, sair } = montar();
    const login = await entrar();

    await sair({ cookie: login.cookie, 'x-csrf-token': login.csrf });
    const seguinte = await sair({ cookie: login.cookie, 'x-csrf-token': login.csrf });

    expect(seguinte.status).toBe(401);
    expect(await seguinte.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    const sessao = await sessaoDoSid(login.sid);
    expect(sessao).toBeDefined();
    expect(sessao!.encerrada_em).not.toBeNull();
  });

  it('audita auth.logout com o profissional como ator e a sessão como alvo (AUD-04)', async () => {
    const { entrar, sair } = montar();
    const login = await entrar();
    const sessao = await sessaoDoSid(login.sid);

    await sair({ cookie: login.cookie, 'x-csrf-token': login.csrf });

    const eventos = await comoAdmin(
      "select ator, acao, alvo_tipo, alvo_id from audit_log where usuario_id = $1 and acao = 'auth.logout'",
      [login.conta.id],
    );
    expect(eventos).toEqual([
      { ator: login.conta.id, acao: 'auth.logout', alvo_tipo: 'auth', alvo_id: sessao!.id },
    ]);
  });
});

describe('sair exige sessão e CSRF', LENTO, () => {
  it('sem x-csrf-token responde 403 e a sessão continua aberta, sem auditoria', async () => {
    const { entrar, sair } = montar();
    const login = await entrar();

    const resposta = await sair({ cookie: login.cookie });

    expect(resposta.status).toBe(403);
    expect((await sessaoDoSid(login.sid))!.encerrada_em).toBeNull();
    const eventos = await comoAdmin(
      "select 1 from audit_log where usuario_id = $1 and acao = 'auth.logout'",
      [login.conta.id],
    );
    expect(eventos).toEqual([]);
  });

  it('sem cookie responde 401', async () => {
    const { sair } = montar();

    const resposta = await sair({ 'x-csrf-token': 'qualquer' });

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});
