import { problema } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, criarConta, emailSimulado, emailUnico, ipUnico, sha256 } from '../apoio.ts';

// T47 / AUTH-07: 5 falhas de login em 15 minutos bloqueiam o e-mail ou o IP por 15 minutos, com
// 429 e Retry-After em segundos. O estado fica em tentativa_login (SHA-256 da chave, nunca o
// e-mail). Premissas aceitas: a janela começa na primeira falha; o bloqueio dura 15 min a partir
// da 5ª falha; tentativas durante o bloqueio são recusadas antes de conferir a senha e não contam.
// PREMISSA desta tarefa: login certo não mexe no contador nem no bloqueio.

const QUINZE_MIN_S = 15 * 60;
// Cada login confere bcrypt de custo 12 no banco; os cenários fazem até 7 logins.
const LENTO = { timeout: 30_000 };

function montar() {
  const correio = emailSimulado();
  const app = criarApp({ email: () => correio.cliente, capturarErro: () => {} });
  const entrar = async (email: string, senha: string, ip = ipUnico()) => {
    const resposta = await app.request(
      '/api/auth/entrar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ email, senha }),
      },
      env,
    );
    return {
      status: resposta.status,
      tipo: resposta.headers.get('content-type'),
      retryAfter: resposta.headers.get('retry-after'),
      corpo: (await resposta.json()) as unknown,
    };
  };
  return { entrar, correio };
}

const SENHA_ERRADA = 'senha-errada-de-proposito-1';

interface LinhaTentativa {
  falhas: number;
  janela_inicio: Date | null;
  bloqueado_ate: Date | null;
}
async function tentativa(tipo: 'email' | 'ip', chave: string): Promise<LinhaTentativa | undefined> {
  const [linha] = await comoAdmin<LinhaTentativa>(
    'select falhas, janela_inicio, bloqueado_ate from tentativa_login where tipo = $1 and chave_hash = $2',
    [tipo, await sha256(chave)],
  );
  return linha;
}

// `vezes` falhas para o e-mail, cada uma de um IP novo (só o e-mail acumula).
async function falharPorEmail(
  entrar: ReturnType<typeof montar>['entrar'],
  email: string,
  vezes: number,
) {
  const respostas = [];
  for (let i = 0; i < vezes; i += 1) respostas.push(await entrar(email, SENHA_ERRADA));
  return respostas;
}

describe('limite de 5 falhas (AUTH-07)', LENTO, () => {
  it('a 4ª falha não bloqueia: a tentativa seguinte confere a senha', async () => {
    const { entrar } = montar();
    const conta = await criarConta();

    const falhas = await falharPorEmail(entrar, conta.email, 4);
    const seguinte = await entrar(conta.email, conta.senha);

    expect(falhas.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(seguinte.status).toBe(202);
  });

  it('a 5ª falha bloqueia: a tentativa seguinte recebe 429 mesmo com a senha certa', async () => {
    const { entrar, correio } = montar();
    const conta = await criarConta();

    const falhas = await falharPorEmail(entrar, conta.email, 5);
    const seguinte = await entrar(conta.email, conta.senha);

    expect(falhas.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(seguinte.status).toBe(429);
    expect(seguinte.tipo).toBe('application/problem+json');
    expect(seguinte.corpo).toEqual(problema('muitas_tentativas', 'Muitas tentativas'));
    expect(correio.enviadas).toEqual([]);
  });

  it('guarda o estado em tentativa_login pelo SHA-256 da chave, sem o e-mail', async () => {
    const { entrar } = montar();
    const conta = await criarConta();

    await falharPorEmail(entrar, conta.email, 5);

    const linha = await tentativa('email', conta.email);
    expect(linha!.falhas).toBe(5);
    const duracao = (linha!.bloqueado_ate!.getTime() - Date.now()) / 1000;
    expect(duracao).toBeGreaterThan(QUINZE_MIN_S - 60);
    expect(duracao).toBeLessThanOrEqual(QUINZE_MIN_S + 60);
  });
});

describe('Retry-After em segundos (AUTH-07)', LENTO, () => {
  it('traz os segundos inteiros que faltam, até 15 minutos', async () => {
    const { entrar } = montar();
    const conta = await criarConta();
    await falharPorEmail(entrar, conta.email, 5);

    const { retryAfter } = await entrar(conta.email, conta.senha);

    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(QUINZE_MIN_S - 60);
    expect(Number(retryAfter)).toBeLessThanOrEqual(QUINZE_MIN_S);
  });

  it('acompanha o tempo restante do bloqueio', async () => {
    const { entrar } = montar();
    const conta = await criarConta();
    await falharPorEmail(entrar, conta.email, 5);
    await comoAdmin(
      "update tentativa_login set bloqueado_ate = now() + interval '90 seconds' where tipo = 'email' and chave_hash = $1",
      [await sha256(conta.email)],
    );

    const { status, retryAfter } = await entrar(conta.email, conta.senha);

    expect(status).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(85);
    expect(Number(retryAfter)).toBeLessThanOrEqual(90);
  });
});

describe('bloqueio por e-mail e por IP independentes (AUTH-07)', LENTO, () => {
  it('e-mail bloqueado é recusado de qualquer IP; os IPs das falhas seguem livres', async () => {
    const { entrar } = montar();
    const bloqueada = await criarConta();
    const outra = await criarConta();
    const ipDeUmaFalha = ipUnico();

    await falharPorEmail(entrar, bloqueada.email, 4);
    await entrar(bloqueada.email, SENHA_ERRADA, ipDeUmaFalha);

    expect((await entrar(bloqueada.email, bloqueada.senha)).status).toBe(429);
    expect((await entrar(outra.email, outra.senha, ipDeUmaFalha)).status).toBe(202);
  });

  it('IP bloqueado é recusado para qualquer e-mail; o e-mail certo entra de outro IP', async () => {
    const { entrar } = montar();
    const conta = await criarConta();
    const ip = ipUnico();

    for (let i = 0; i < 5; i += 1) await entrar(emailUnico('ninguem'), SENHA_ERRADA, ip);

    const doIpBloqueado = await entrar(conta.email, conta.senha, ip);
    expect(doIpBloqueado.status).toBe(429);
    expect(Number(doIpBloqueado.retryAfter)).toBeGreaterThan(QUINZE_MIN_S - 60);
    expect((await entrar(conta.email, conta.senha)).status).toBe(202);
    expect((await tentativa('ip', ip))!.falhas).toBe(5);
  });
});

describe('tentativas durante o bloqueio e fim do bloqueio (AUTH-07)', LENTO, () => {
  it('tentativa durante o bloqueio não conta nem estende o bloqueio', async () => {
    const { entrar } = montar();
    const conta = await criarConta();
    await falharPorEmail(entrar, conta.email, 5);
    const antes = await tentativa('email', conta.email);

    await entrar(conta.email, SENHA_ERRADA);
    await entrar(conta.email, conta.senha);

    expect(await tentativa('email', conta.email)).toEqual(antes);
  });

  it('passados os 15 minutos do bloqueio, a senha certa volta a entrar', async () => {
    const { entrar } = montar();
    const conta = await criarConta();
    await falharPorEmail(entrar, conta.email, 5);
    await comoAdmin(
      "update tentativa_login set bloqueado_ate = now() - interval '1 second' where tipo = 'email' and chave_hash = $1",
      [await sha256(conta.email)],
    );

    expect((await entrar(conta.email, conta.senha)).status).toBe(202);
  });

  it('falhas de mais de 15 minutos atrás não somam: a janela recomeça', async () => {
    const { entrar } = montar();
    const conta = await criarConta();
    await falharPorEmail(entrar, conta.email, 4);
    await comoAdmin(
      "update tentativa_login set janela_inicio = now() - interval '15 minutes 1 second' where tipo = 'email' and chave_hash = $1",
      [await sha256(conta.email)],
    );

    await entrar(conta.email, SENHA_ERRADA);

    expect((await tentativa('email', conta.email))!.falhas).toBe(1);
    expect((await entrar(conta.email, conta.senha)).status).toBe(202);
  });
});

describe('sucesso não zera o bloqueio vigente (AUTH-07)', LENTO, () => {
  it('login certo entre as falhas não zera o contador: a 5ª falha bloqueia', async () => {
    const { entrar } = montar();
    const conta = await criarConta();

    await falharPorEmail(entrar, conta.email, 4);
    expect((await entrar(conta.email, conta.senha)).status).toBe(202);
    await falharPorEmail(entrar, conta.email, 1);

    expect((await entrar(conta.email, conta.senha)).status).toBe(429);
  });

  it('login certo de outro IP não libera o IP bloqueado', async () => {
    const { entrar } = montar();
    const conta = await criarConta();
    const ip = ipUnico();
    for (let i = 0; i < 5; i += 1) await entrar(emailUnico('ninguem'), SENHA_ERRADA, ip);
    const antes = await tentativa('ip', ip);

    expect((await entrar(conta.email, conta.senha)).status).toBe(202);

    expect(await tentativa('ip', ip)).toEqual(antes);
    expect((await entrar(conta.email, conta.senha, ip)).status).toBe(429);
  });
});
