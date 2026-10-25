import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, criarConta, emailSimulado, emailUnico, ipUnico, sha256 } from '../apoio.ts';

// T48 / AUTH-04, AUTH-05, AUTH-10, AUD-04: POST /api/auth/2fa/verificar.
// - Código certo dentro da validade: cria a sessão, define o cookie __Host-sid (Path=/, Secure,
//   HttpOnly, SameSite=Lax, sem Domain), responde 200 com o token CSRF e audita auth.login_ok.
// - 5 códigos errados no mesmo desafio o invalidam; dali em diante, 401 até para o código certo.
// - Login concluído cria id de sessão novo e encerra a sessão anterior apresentada no navegador.
// - Código usado (ou vencido, AUTH-03) não vale de novo.

const LENTO = { timeout: 30_000 };

function montar() {
  const correio = emailSimulado();
  const app = criarApp({ email: () => correio.cliente, capturarErro: () => {} });
  const pedir = (caminho: string, corpo: unknown, cookie?: string) =>
    app.request(
      caminho,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(corpo),
      },
      env,
    );
  // Faz o primeiro passo (senha) e devolve o código que chegou por e-mail.
  const pedirCodigo = async (conta: { email: string; senha: string }) => {
    const resposta = await pedir('/api/auth/entrar', { email: conta.email, senha: conta.senha });
    expect(resposta.status).toBe(202);
    return /\b(\d{6})\b/.exec(correio.enviadas.at(-1)!.texto)![1]!;
  };
  const verificar = async (email: string, codigo: string, cookie?: string) => {
    const resposta = await pedir('/api/auth/2fa/verificar', { email, codigo }, cookie);
    return {
      status: resposta.status,
      setCookie: resposta.headers.get('set-cookie'),
      corpo: (await resposta.json()) as Record<string, unknown>,
    };
  };
  return { pedirCodigo, verificar };
}

const valorDoCookie = (setCookie: string | null): string => {
  const achado = /^__Host-sid=([^;]+)/.exec(setCookie ?? '');
  if (!achado) throw new Error(`Set-Cookie sem __Host-sid: ${setCookie}`);
  return achado[1]!;
};

const outroCodigo = (codigo: string) => String((Number(codigo) + 1) % 1_000_000).padStart(6, '0');

interface LinhaSessao {
  id: string;
  usuario_id: string;
  token_hash: Buffer;
  encerrada_em: Date | null;
}
const sessoesDe = (usuarioId: string) =>
  comoAdmin<LinhaSessao>('select * from sessao where usuario_id = $1 order by criada_em', [
    usuarioId,
  ]);
const sessaoPorCookie = async (valor: string) =>
  (
    await comoAdmin<LinhaSessao>('select * from sessao where token_hash = $1', [
      await sha256(valor),
    ])
  )[0];

describe('código certo (AUTH-04)', LENTO, () => {
  it('responde 200 com o token CSRF e define o cookie __Host-sid com os atributos exigidos', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();
    const codigo = await pedirCodigo(conta);

    const resposta = await verificar(conta.email, codigo);

    expect(resposta.status).toBe(200);
    expect(Object.keys(resposta.corpo)).toEqual(['csrf_token']);
    expect(resposta.corpo['csrf_token']).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const atributos = resposta.setCookie!.split(';').map((a) => a.trim().toLowerCase());
    expect(atributos[0]).toMatch(/^__host-sid=[a-z0-9_-]{43}$/);
    expect(atributos).toContain('path=/');
    expect(atributos).toContain('secure');
    expect(atributos).toContain('httponly');
    expect(atributos).toContain('samesite=lax');
    expect(atributos.some((a) => a.startsWith('domain'))).toBe(false);
  });

  it('a sessão guarda só o SHA-256 do id de 256 bits do cookie', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();

    const { setCookie } = await verificar(conta.email, await pedirCodigo(conta));

    const valor = valorDoCookie(setCookie);
    expect(Buffer.from(valor, 'base64url')).toHaveLength(32);
    const [sessao] = await sessoesDe(conta.id);
    expect(sessao!.token_hash.equals(await sha256(valor))).toBe(true);
    expect(sessao!.encerrada_em).toBeNull();
  });

  it('audita auth.login_ok com o profissional como ator e a sessão como alvo (AUD-04)', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();

    await verificar(conta.email, await pedirCodigo(conta));

    const [sessao] = await sessoesDe(conta.id);
    const eventos = await comoAdmin(
      "select usuario_id, ator, acao, alvo_tipo, alvo_id from audit_log where usuario_id = $1 and acao = 'auth.login_ok'",
      [conta.id],
    );
    expect(eventos).toEqual([
      {
        usuario_id: conta.id,
        ator: conta.id,
        acao: 'auth.login_ok',
        alvo_tipo: 'auth',
        alvo_id: sessao!.id,
      },
    ]);
  });

  it('código errado, e-mail de outra conta ou sem desafio respondem 401 sem sessão', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();
    const semDesafio = await criarConta();
    const codigo = await pedirCodigo(conta);

    const respostas = [
      await verificar(conta.email, outroCodigo(codigo)),
      await verificar(semDesafio.email, codigo),
      await verificar(emailUnico('ninguem'), codigo),
    ];

    for (const resposta of respostas) {
      expect(resposta.status).toBe(401);
      expect(resposta.corpo).toEqual(RESPOSTA_LOGIN_RECUSADO);
      expect(resposta.setCookie).toBeNull();
    }
    expect(await sessoesDe(conta.id)).toEqual([]);
  });

  it('corpo inválido responde 422 validacao', async () => {
    const { verificar } = montar();

    const resposta = await verificar('ana@exemplo.com.br', '12345');

    expect(resposta.status).toBe(422);
    expect(resposta.corpo).toMatchObject({ codigo: 'validacao' });
  });
});

describe('uso único e validade do código (AUTH-03)', LENTO, () => {
  it('código já usado não vale de novo', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();
    const codigo = await pedirCodigo(conta);

    expect((await verificar(conta.email, codigo)).status).toBe(200);
    const segunda = await verificar(conta.email, codigo);

    expect(segunda.status).toBe(401);
    expect(segunda.setCookie).toBeNull();
    expect(await sessoesDe(conta.id)).toHaveLength(1);
  });

  it('o código de um login anterior deixa de valer quando outro é pedido', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();
    const antigo = await pedirCodigo(conta);
    const novo = await pedirCodigo(conta);

    expect((await verificar(conta.email, antigo)).status).toBe(antigo === novo ? 200 : 401);
    if (antigo !== novo) expect((await verificar(conta.email, novo)).status).toBe(200);
  });

  it('dentro dos 10 minutos vale; vencido não vale', async () => {
    const { pedirCodigo, verificar } = montar();
    const valendo = await criarConta();
    const vencida = await criarConta();
    const codigoValendo = await pedirCodigo(valendo);
    const codigoVencido = await pedirCodigo(vencida);
    await comoAdmin(
      "update desafio_2fa set expira_em = now() + interval '5 seconds' where usuario_id = $1",
      [valendo.id],
    );
    await comoAdmin(
      "update desafio_2fa set expira_em = now() - interval '1 second' where usuario_id = $1",
      [vencida.id],
    );

    expect((await verificar(valendo.email, codigoValendo)).status).toBe(200);
    expect((await verificar(vencida.email, codigoVencido)).status).toBe(401);
    expect(await sessoesDe(vencida.id)).toEqual([]);
  });
});

describe('5 erros invalidam o desafio (AUTH-05)', LENTO, () => {
  it('4 erros não invalidam: o código certo ainda entra', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();
    const codigo = await pedirCodigo(conta);

    for (let i = 0; i < 4; i += 1)
      expect((await verificar(conta.email, outroCodigo(codigo))).status).toBe(401);

    expect((await verificar(conta.email, codigo)).status).toBe(200);
  });

  it('o 5º erro invalida: o código certo passa a receber 401', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();
    const codigo = await pedirCodigo(conta);

    for (let i = 0; i < 5; i += 1)
      expect((await verificar(conta.email, outroCodigo(codigo))).status).toBe(401);
    const certo = await verificar(conta.email, codigo);

    expect(certo.status).toBe(401);
    expect(certo.corpo).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(await sessoesDe(conta.id)).toEqual([]);
    const [desafio] = await comoAdmin<{ erros: number; invalidado_em: Date | null }>(
      'select erros, invalidado_em from desafio_2fa where usuario_id = $1',
      [conta.id],
    );
    expect(desafio!.erros).toBe(5);
    expect(desafio!.invalidado_em).not.toBeNull();
  });
});

describe('sessão nova a cada login (AUTH-10)', LENTO, () => {
  it('cria id novo e encerra a sessão anterior apresentada pelo navegador', async () => {
    const { pedirCodigo, verificar } = montar();
    const conta = await criarConta();
    const primeira = valorDoCookie(
      (await verificar(conta.email, await pedirCodigo(conta))).setCookie,
    );
    const deOutroNavegador = valorDoCookie(
      (await verificar(conta.email, await pedirCodigo(conta))).setCookie,
    );

    const segunda = valorDoCookie(
      (await verificar(conta.email, await pedirCodigo(conta), `__Host-sid=${primeira}`)).setCookie,
    );

    expect(segunda).not.toBe(primeira);
    expect((await sessaoPorCookie(primeira))!.encerrada_em).not.toBeNull();
    expect((await sessaoPorCookie(segunda))!.encerrada_em).toBeNull();
    expect((await sessaoPorCookie(deOutroNavegador))!.encerrada_em).toBeNull();
  });
});
