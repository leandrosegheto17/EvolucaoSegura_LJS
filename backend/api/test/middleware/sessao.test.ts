import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type VariaveisSessao, sessao } from '../../src/middleware/sessao.ts';
import { gerarToken } from '../../src/tokens.ts';
import { comoAdmin, criarConta } from '../apoio.ts';

// T50 / AUTH-09: o middleware de sessão acha a sessão pelo SHA-256 do cookie __Host-sid, encerra
// após 15 minutos sem requisição autenticada ou 12 horas desde o login (o que vier primeiro) e
// renova o último uso a cada requisição. Cookie ausente, inválido, vencido ou de sessão encerrada
// responde 401 sem chegar ao handler. O "relógio simulado" é o do banco: os testes recuam
// criada_em e ultimo_uso_em, e o middleware compara com o now() do banco.

const LENTO = { timeout: 30_000 };

function montar() {
  const executados: string[] = [];
  const app = new Hono<{ Bindings: Cloudflare.Env; Variables: VariaveisSessao }>();
  app.use('/protegida', sessao);
  app.get('/protegida', (c) => {
    executados.push(c.var.usuarioId);
    return c.json({ usuarioId: c.var.usuarioId, sessaoId: c.var.sessaoId });
  });
  const pedir = async (cookie?: string) => {
    const resposta = await app.request('/protegida', { headers: cookie ? { cookie } : {} }, env);
    return {
      status: resposta.status,
      tipo: resposta.headers.get('content-type'),
      corpo: (await resposta.json()) as unknown,
    };
  };
  return { pedir, executados };
}

interface Marcos {
  criadaHa?: string;
  usadaHa?: string;
  encerrada?: boolean;
}

// Semeia uma sessão do usuário, com os marcos recuados no relógio do banco.
async function semearSessao(usuarioId: string, marcos: Marcos = {}) {
  const { token: sid, hash } = await gerarToken();
  const [linha] = await comoAdmin<{ id: string }>(
    `insert into sessao (usuario_id, token_hash, criada_em, ultimo_uso_em, encerrada_em)
     values ($1, $2, now() - $3::interval, now() - $4::interval, case when $5 then now() end)
     returning id`,
    [
      usuarioId,
      hash,
      marcos.criadaHa ?? '0 seconds',
      marcos.usadaHa ?? '0 seconds',
      marcos.encerrada ?? false,
    ],
  );
  return { sid, id: linha!.id, cookie: `__Host-sid=${sid}` };
}

const linhaSessao = async (id: string) =>
  (
    await comoAdmin<{ ultimo_uso_em: Date; encerrada_em: Date | null; idade_uso_s: number }>(
      `select ultimo_uso_em, encerrada_em,
              extract(epoch from now() - ultimo_uso_em)::float as idade_uso_s
       from sessao where id = $1`,
      [id],
    )
  )[0]!;

describe('sessão válida (AUTH-09)', LENTO, () => {
  it('passa ao handler com o usuário e a sessão do cookie', async () => {
    const { pedir } = montar();
    const conta = await criarConta();
    const sessaoA = await semearSessao(conta.id);

    const resposta = await pedir(sessaoA.cookie);

    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toEqual({ usuarioId: conta.id, sessaoId: sessaoA.id });
  });

  it('atualiza o último uso a cada requisição', async () => {
    const { pedir } = montar();
    const conta = await criarConta();
    const sessaoA = await semearSessao(conta.id, { usadaHa: '10 minutes' });

    await pedir(sessaoA.cookie);
    const depoisDaPrimeira = await linhaSessao(sessaoA.id);
    await pedir(sessaoA.cookie);
    const depoisDaSegunda = await linhaSessao(sessaoA.id);

    expect(depoisDaPrimeira.idade_uso_s).toBeLessThan(5);
    expect(depoisDaSegunda.ultimo_uso_em.getTime()).toBeGreaterThan(
      depoisDaPrimeira.ultimo_uso_em.getTime(),
    );
  });
});

describe('recusa com 401 sem executar o handler (AUTH-09)', LENTO, () => {
  it.each([
    ['sem cookie', undefined],
    ['cookie com id que não existe', '__Host-sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['cookie vazio', '__Host-sid='],
  ])('%s', async (_caso, cookie) => {
    const { pedir, executados } = montar();

    const resposta = await pedir(cookie);

    expect(resposta.status).toBe(401);
    expect(resposta.tipo).toBe('application/problem+json');
    expect(resposta.corpo).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(executados).toEqual([]);
  });

  it('sessão encerrada', async () => {
    const { pedir, executados } = montar();
    const conta = await criarConta();
    const sessaoA = await semearSessao(conta.id, { encerrada: true });

    expect((await pedir(sessaoA.cookie)).status).toBe(401);
    expect(executados).toEqual([]);
  });
});

describe('15 minutos sem uso (AUTH-09)', LENTO, () => {
  it('a 5 s do limite ainda vale', async () => {
    const { pedir } = montar();
    const conta = await criarConta();
    const sessaoA = await semearSessao(conta.id, { usadaHa: '14 minutes 55 seconds' });

    expect((await pedir(sessaoA.cookie)).status).toBe(200);
  });

  it('no limite vence: 401 e a sessão fica encerrada', async () => {
    const { pedir, executados } = montar();
    const conta = await criarConta();
    const sessaoA = await semearSessao(conta.id, { usadaHa: '15 minutes' });

    expect((await pedir(sessaoA.cookie)).status).toBe(401);
    expect(executados).toEqual([]);
    expect((await linhaSessao(sessaoA.id)).encerrada_em).not.toBeNull();
    expect((await pedir(sessaoA.cookie)).status).toBe(401);
  });
});

describe('12 horas desde o login (AUTH-09)', LENTO, () => {
  it('a 5 s do limite ainda vale, mesmo em uso', async () => {
    const { pedir } = montar();
    const conta = await criarConta();
    const sessaoA = await semearSessao(conta.id, { criadaHa: '11 hours 59 minutes 55 seconds' });

    expect((await pedir(sessaoA.cookie)).status).toBe(200);
  });

  it('no limite vence mesmo com uso recente: 401 e a sessão fica encerrada', async () => {
    const { pedir } = montar();
    const conta = await criarConta();
    const sessaoA = await semearSessao(conta.id, { criadaHa: '12 hours', usadaHa: '1 minute' });

    expect((await pedir(sessaoA.cookie)).status).toBe(401);
    expect((await linhaSessao(sessaoA.id)).encerrada_em).not.toBeNull();
  });
});
