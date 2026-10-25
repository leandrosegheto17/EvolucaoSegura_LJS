import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ErroEnvioEmail } from '../../src/integracoes/resend.ts';
import { comoAdmin, criarConta, emailSimulado, emailUnico, ipUnico, sha256 } from '../apoio.ts';

// T46 / AUTH-01, AUTH-02, AUTH-03, AUTH-08, CAD-09: POST /api/auth/entrar.
// - E-mail e senha corretos: 202 {status: "2fa_required"}, código de 6 dígitos por e-mail e
//   nenhuma sessão criada.
// - Senha errada, e-mail inexistente, conta não confirmada ou bloqueada para exclusão: o mesmo
//   401 (corpo único) e tempo equivalente (o hash é calculado também sem conta).
// - Código: CSPRNG, guardado só como HMAC-SHA256, válido por 10 minutos, uso único.
// - Falha do Resend: 503 mail_unavailable, sem contar falha de login.

const SEGREDO = (env as unknown as { HMAC_2FA_SEGREDO: string }).HMAC_2FA_SEGREDO;

function montar() {
  const correio = emailSimulado();
  const capturarErro = vi.fn();
  const app = criarApp({ email: () => correio.cliente, capturarErro });
  const entrar = async (corpo: unknown, ip = ipUnico()) => {
    const resposta = await app.request(
      '/api/auth/entrar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify(corpo),
      },
      env,
    );
    return {
      status: resposta.status,
      tipo: resposta.headers.get('content-type'),
      cookie: resposta.headers.get('set-cookie'),
      corpo: await resposta.text(),
    };
  };
  return { correio, capturarErro, entrar };
}

const codigoDoEmail = (texto: string): string => {
  const achado = /\b(\d{6})\b/.exec(texto);
  if (!achado) throw new Error('código de 6 dígitos não encontrado no e-mail');
  return achado[1]!;
};

interface LinhaDesafio {
  codigo_hmac: Buffer;
  criado_em: Date;
  expira_em: Date;
  erros: number;
  usado_em: Date | null;
  invalidado_em: Date | null;
}
const desafiosDe = (usuarioId: string) =>
  comoAdmin<LinhaDesafio>('select * from desafio_2fa where usuario_id = $1 order by criado_em', [
    usuarioId,
  ]);

const sessoesDe = (usuarioId: string) =>
  comoAdmin('select id from sessao where usuario_id = $1', [usuarioId]);

// HMAC-SHA256 calculado aqui, de forma independente, com a chave do ambiente de teste.
async function hmacEsperado(usuarioId: string, codigo: string): Promise<Buffer> {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SEGREDO),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinatura = await crypto.subtle.sign(
    'HMAC',
    chave,
    new TextEncoder().encode(`${usuarioId}:${codigo}`),
  );
  return Buffer.from(assinatura);
}

describe('credenciais corretas (AUTH-01)', () => {
  it('responde 202 2fa_required sem criar sessão nem cookie', async () => {
    const { entrar } = montar();
    const conta = await criarConta();

    const resposta = await entrar({ email: conta.email, senha: conta.senha });

    expect(resposta.status).toBe(202);
    expect(JSON.parse(resposta.corpo)).toEqual({ status: '2fa_required' });
    expect(resposta.cookie).toBeNull();
    expect(await sessoesDe(conta.id)).toEqual([]);
  });

  it('envia ao e-mail da conta um código de 6 dígitos', async () => {
    const { entrar, correio } = montar();
    const conta = await criarConta();

    await entrar({ email: conta.email.toUpperCase(), senha: conta.senha });

    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]!.para).toBe(conta.email);
    expect(codigoDoEmail(correio.enviadas[0]!.texto)).toMatch(/^\d{6}$/);
  });

  it('gera um código novo a cada login', async () => {
    const { entrar, correio } = montar();
    const conta = await criarConta();

    for (let i = 0; i < 3; i += 1) await entrar({ email: conta.email, senha: conta.senha });

    const codigos = correio.enviadas.map((m) => codigoDoEmail(m.texto));
    expect(new Set(codigos).size).toBeGreaterThan(1);
  });
});

describe('código guardado só como HMAC, 10 minutos, uso único (AUTH-03)', () => {
  it('grava o HMAC-SHA256 do código, nunca o código nem o SHA-256 dele', async () => {
    const { entrar, correio } = montar();
    const conta = await criarConta();

    await entrar({ email: conta.email, senha: conta.senha });
    const codigo = codigoDoEmail(correio.enviadas[0]!.texto);

    const [desafio] = await desafiosDe(conta.id);
    expect(desafio!.codigo_hmac.equals(await hmacEsperado(conta.id, codigo))).toBe(true);
    expect(desafio!.codigo_hmac.equals(await sha256(codigo))).toBe(false);
    expect(desafio!.codigo_hmac.toString('latin1')).not.toContain(codigo);
  });

  it('o desafio vale por 10 minutos e nasce sem uso e sem erros', async () => {
    const { entrar } = montar();
    const conta = await criarConta();

    await entrar({ email: conta.email, senha: conta.senha });

    const [desafio] = await desafiosDe(conta.id);
    expect(desafio!.expira_em.getTime() - desafio!.criado_em.getTime()).toBe(10 * 60_000);
    expect(desafio).toMatchObject({ erros: 0, usado_em: null, invalidado_em: null });
  });

  it('um login novo invalida o desafio anterior ainda aberto (um código válido por vez)', async () => {
    const { entrar } = montar();
    const conta = await criarConta();

    await entrar({ email: conta.email, senha: conta.senha });
    await entrar({ email: conta.email, senha: conta.senha });

    const [primeiro, segundo] = await desafiosDe(conta.id);
    expect(primeiro!.invalidado_em).not.toBeNull();
    expect(segundo!.invalidado_em).toBeNull();
  });
});

describe('recusa com 401 único (AUTH-02, CAD-09)', () => {
  it('senha errada responde 401 com o corpo único e não envia código', async () => {
    const { entrar, correio } = montar();
    const conta = await criarConta();

    const resposta = await entrar({ email: conta.email, senha: `${conta.senha}x` });

    expect(resposta.status).toBe(401);
    expect(resposta.tipo).toBe('application/problem+json');
    expect(JSON.parse(resposta.corpo)).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(correio.enviadas).toEqual([]);
    expect(await desafiosDe(conta.id)).toEqual([]);
  });

  it('e-mail inexistente, conta não confirmada e conta bloqueada recebem o mesmo 401', async () => {
    const { entrar, correio } = montar();
    const referencia = await criarConta();
    const pendente = await criarConta({ confirmada: false });
    const bloqueada = await criarConta({ bloqueada: true });

    const senhaErrada = await entrar({ email: referencia.email, senha: 'outra-senha-qualquer-1' });
    const inexistente = await entrar({ email: emailUnico('ninguem'), senha: referencia.senha });
    const naoConfirmada = await entrar({ email: pendente.email, senha: pendente.senha });
    const paraExclusao = await entrar({ email: bloqueada.email, senha: bloqueada.senha });

    for (const resposta of [inexistente, naoConfirmada, paraExclusao]) {
      expect(resposta.status).toBe(401);
      expect(resposta.tipo).toBe(senhaErrada.tipo);
      expect(resposta.corpo).toBe(senhaErrada.corpo);
    }
    expect(correio.enviadas).toEqual([]);
    expect(await desafiosDe(pendente.id)).toEqual([]);
    expect(await desafiosDe(bloqueada.id)).toEqual([]);
  });

  it('e-mail inexistente também calcula o hash (tempo equivalente)', async () => {
    const { entrar } = montar();
    const conta = await criarConta();
    const medir = async (email: string) => {
      const inicio = performance.now();
      await entrar({ email, senha: 'outra-senha-qualquer-1' });
      return performance.now() - inicio;
    };

    await medir(conta.email);
    const existente = await medir(conta.email);
    const inexistente = await medir(emailUnico('ninguem'));

    expect(inexistente).toBeGreaterThan(existente * 0.5);
  });

  it('corpo inválido responde 422 validacao, sem conferir a senha', async () => {
    const { entrar } = montar();

    const resposta = await entrar({ email: 'nao-e-email', senha: 'x', extra: 1 });

    expect(resposta.status).toBe(422);
    expect(JSON.parse(resposta.corpo)).toMatchObject({ codigo: 'validacao' });
  });
});

describe('falha do e-mail do código (AUTH-08)', () => {
  it('responde 503 mail_unavailable, vai ao Sentry e não deixa código válido', async () => {
    const { entrar, correio, capturarErro } = montar();
    const conta = await criarConta();
    const erro = new ErroEnvioEmail('limite', 429);
    correio.falhar(erro);

    const resposta = await entrar({ email: conta.email, senha: conta.senha });

    expect(resposta.status).toBe(503);
    expect(resposta.tipo).toBe('application/problem+json');
    expect(JSON.parse(resposta.corpo)).toMatchObject({ status: 503, codigo: 'mail_unavailable' });
    expect(resposta.cookie).toBeNull();
    expect(capturarErro).toHaveBeenCalledWith(erro);
    expect(await desafiosDe(conta.id)).toEqual([]);
  });

  it('não conta falha de login nem para o e-mail nem para o IP', async () => {
    const { entrar, correio } = montar();
    const conta = await criarConta();
    const ip = ipUnico();
    correio.falhar(new ErroEnvioEmail('falha', 500));

    await entrar({ email: conta.email, senha: conta.senha }, ip);

    const tentativas = await comoAdmin(
      'select tipo from tentativa_login where (tipo, chave_hash) in (($1, $2), ($3, $4))',
      ['email', await sha256(conta.email), 'ip', await sha256(ip)],
    );
    expect(tentativas).toEqual([]);
  });
});
