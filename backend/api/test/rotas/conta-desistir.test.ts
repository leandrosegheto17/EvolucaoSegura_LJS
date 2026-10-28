import { RESPOSTA_ENTRAR } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { grupoDaRota } from '../../src/middleware/limite.ts';
import { tarefaPurga } from '../../src/tarefas/purga.ts';
import { comoAdmin, emailSimulado } from '../apoio.ts';
import {
  type App,
  contaComSessao,
  eventosDe,
  postar,
  semearExportacao,
  semearToken,
  tokensDe,
} from './conta-apoio.ts';
import { type Estado, linhaAssinatura, semearAssinatura } from './plano-apoio.ts';

// T151 / CONTA-04, AUD-04: POST /api/conta/desistir, rota pública com o token do link de
// desistência (enviado na confirmação, T181, válido pelos 30 dias até a purga). Antes da purga:
// desbloqueia a conta, consome o token, audita conta.exclusao_desistida e responde 200; o
// profissional volta a entrar com senha e 2FA, no trial restante (trial com periodo_fim no
// futuro) ou no plano free (todos os outros casos, com o id da assinatura do Asaas limpo).
// Link vencido, usado, de outro tipo, de conta não bloqueada ou depois da purga (as linhas do
// profissional, inclusive os tokens, já não existem): 400 link_invalido sem mudar nada.

const LENTO = { timeout: 30_000 };
const DIA = 24 * 60 * 60_000;

function montar() {
  const correio = emailSimulado();
  const app = criarApp({
    capturarErro: () => {},
    email: () => correio.cliente,
    emSegundoPlano: () => {},
  });
  return { app, correio };
}

const desistir = (app: App, corpo: unknown) => postar(app, '/api/conta/desistir', corpo);

// Conta bloqueada há `diasBloqueada` dias, com o link de desistência que vence junto com a purga.
async function contaBloqueada(diasBloqueada = 1) {
  const conta = await contaComSessao();
  await comoAdmin(
    `update usuario set bloqueado_exclusao_em = now() - make_interval(days => $2) where id = $1`,
    [conta.usuarioId, diasBloqueada],
  );
  await comoAdmin('update sessao set encerrada_em = now() where usuario_id = $1', [
    conta.usuarioId,
  ]);
  const token = await semearToken(conta.usuarioId, 'desistencia', (30 - diasBloqueada) * 24 * 60);
  return { ...conta, token };
}

const bloqueio = async (usuarioId: string) =>
  (
    await comoAdmin<{ b: Date | null }>(
      'select bloqueado_exclusao_em as b from usuario where id = $1',
      [usuarioId],
    )
  )[0]!.b;

describe('desistir antes da purga (CONTA-04)', LENTO, () => {
  it('desbloqueia a conta, consome o link e responde 200', async () => {
    const { app } = montar();
    const conta = await contaBloqueada(5);

    const resposta = await desistir(app, { token: conta.token });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ status: 'desbloqueada' });
    expect(await bloqueio(conta.usuarioId)).toBeNull();
    expect((await tokensDe(conta.usuarioId, 'desistencia'))[0]!.usado_em).not.toBeNull();
  });

  it('volta a entrar com senha e 2FA', async () => {
    const { app, correio } = montar();
    const conta = await contaBloqueada();
    const antes = await postar(app, '/api/auth/entrar', { email: conta.email, senha: conta.senha });
    expect(antes.status).toBe(401);

    await desistir(app, { token: conta.token });

    const depois = await postar(app, '/api/auth/entrar', {
      email: conta.email,
      senha: conta.senha,
    });
    expect(depois.status).toBe(202);
    expect(await depois.json()).toEqual(RESPOSTA_ENTRAR);
    expect(correio.enviadas.map((m) => m.para)).toEqual([conta.email]);
  });

  it('o mesmo link não serve duas vezes', async () => {
    const { app } = montar();
    const conta = await contaBloqueada();
    expect((await desistir(app, { token: conta.token })).status).toBe(200);
    const segunda = await desistir(app, { token: conta.token });
    expect(segunda.status).toBe(400);
    expect(await segunda.json()).toMatchObject({ codigo: 'link_invalido' });
  });

  it('no último dia antes da purga ainda vale', async () => {
    const { app } = montar();
    const conta = await contaBloqueada(29);
    expect((await desistir(app, { token: conta.token })).status).toBe(200);
  });

  it('audita conta.exclusao_desistida com alvo conta', async () => {
    const { app } = montar();
    const conta = await contaBloqueada();
    await desistir(app, { token: conta.token });
    expect(await eventosDe(conta.usuarioId)).toEqual([
      {
        ator: conta.usuarioId,
        acao: 'conta.exclusao_desistida',
        alvo_tipo: 'conta',
        alvo_id: conta.usuarioId,
        campos_alterados: ['bloqueado_exclusao_em'],
        origem_ip: expect.any(String),
        origem_ua: 'Mozilla/5',
      },
    ]);
  });

  it('não toca na conta de outro profissional bloqueado', async () => {
    const { app } = montar();
    const outro = await contaBloqueada();
    const conta = await contaBloqueada();
    await desistir(app, { token: conta.token });
    expect(await bloqueio(outro.usuarioId)).not.toBeNull();
  });
});

describe('plano free ou trial restante (CONTA-04)', LENTO, () => {
  const FUTURO = () => new Date(Date.now() + 5 * DIA).toISOString();
  const PASSADO = () => new Date(Date.now() - 5 * DIA).toISOString();

  it('trial com dias restantes continua trial, com o mesmo fim', async () => {
    const { app } = montar();
    const conta = await contaBloqueada();
    const fim = FUTURO();
    await semearAssinatura(conta.usuarioId, 'trial', { periodoFim: fim });
    await desistir(app, { token: conta.token });
    expect(await linhaAssinatura(conta.usuarioId)).toMatchObject({
      plano: 'pro',
      status: 'trial',
      periodo_fim: new Date(fim),
    });
    expect(await eventosDe(conta.usuarioId, 'assinatura.')).toEqual([]);
  });

  it.each([
    ['trial vencido', 'trial', PASSADO, false],
    ['cancelada (o Pro pago acabou na confirmação)', 'cancelada', FUTURO, true],
    ['cancelada já vencida', 'cancelada', PASSADO, true],
    ['atrasada', 'atrasada', PASSADO, true],
    ['ativa (pagamento chegou depois do cancelamento)', 'ativa', FUTURO, true],
  ] as const)(
    '%s vai para free, sem o id da assinatura do Asaas',
    async (_c, status, fim, asaas) => {
      const { app } = montar();
      const conta = await contaBloqueada();
      await semearAssinatura(conta.usuarioId, status as Estado, {
        periodoFim: fim(),
        comAsaas: asaas,
      });
      await desistir(app, { token: conta.token });
      expect(await linhaAssinatura(conta.usuarioId)).toMatchObject({
        plano: 'free',
        status: 'free',
        asaas_subscription_id: null,
        vencimento_atraso: null,
      });
      const eventos = await eventosDe(conta.usuarioId, 'assinatura.');
      expect(eventos.at(-1)).toMatchObject({ acao: 'assinatura.free', ator: conta.usuarioId });
    },
  );

  it('free continua free', async () => {
    const { app } = montar();
    const conta = await contaBloqueada();
    await semearAssinatura(conta.usuarioId, 'free');
    expect((await desistir(app, { token: conta.token })).status).toBe(200);
    expect(await linhaAssinatura(conta.usuarioId)).toMatchObject({ plano: 'free', status: 'free' });
  });
});

describe('link que não serve: 400 link_invalido sem mudar nada', LENTO, () => {
  async function esperarInvalido(app: App, token: string, usuarioId: string) {
    const resposta = await desistir(app, { token });
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ codigo: 'link_invalido' });
    expect(await eventosDe(usuarioId)).toEqual([]);
  }

  it('depois da purga (os tokens do profissional já não existem)', async () => {
    const { app } = montar();
    const conta = await contaBloqueada();
    // A purga real (T152): o bloqueio vai a 1980 e a tarefa roda 31 dias depois (datas antigas
    // isolam este teste das contas bloqueadas hoje pelos outros arquivos).
    const bloqueioAntigo = new Date('1980-03-01T12:00:00.000Z');
    await comoAdmin('update usuario set bloqueado_exclusao_em = $2 where id = $1', [
      conta.usuarioId,
      bloqueioAntigo,
    ]);
    await tarefaPurga().executar({
      agora: new Date(bloqueioAntigo.getTime() + 31 * DIA),
      desde: null,
      limite: 1000,
      env,
      emSegundoPlano: () => {},
      capturarErro: () => {},
    });
    expect(
      await comoAdmin('select id from conta_excluida where id = $1', [conta.usuarioId]),
    ).toEqual([{ id: conta.usuarioId }]);
    await esperarInvalido(app, conta.token, conta.usuarioId);
    // A conta não foi desbloqueada: continua purgada (não existe mais).
    expect(await comoAdmin('select id from usuario where id = $1', [conta.usuarioId])).toEqual([]);
  });

  it('passados os 30 dias, mesmo antes de a purga rodar', async () => {
    const { app } = montar();
    const conta = await contaBloqueada(30);
    await esperarInvalido(app, conta.token, conta.usuarioId);
    expect(await bloqueio(conta.usuarioId)).not.toBeNull();
  });

  it('link ainda aberto, mas o bloqueio passou de 30 dias', async () => {
    const { app } = montar();
    const conta = await contaBloqueada(1);
    await comoAdmin(
      `update usuario set bloqueado_exclusao_em = now() - interval '30 days' where id = $1`,
      [conta.usuarioId],
    );
    await esperarInvalido(app, conta.token, conta.usuarioId);
  });

  it('conta que não está bloqueada', async () => {
    const { app } = montar();
    const conta = await contaComSessao();
    const token = await semearToken(conta.usuarioId, 'desistencia', 60);
    await esperarInvalido(app, token, conta.usuarioId);
  });

  it('link de outro tipo (confirmação da exclusão)', async () => {
    const { app } = montar();
    const conta = await contaBloqueada();
    const token = await semearToken(conta.usuarioId, 'exclusao', 30);
    await esperarInvalido(app, token, conta.usuarioId);
    expect(await bloqueio(conta.usuarioId)).not.toBeNull();
  });

  it('desconhecido', async () => {
    const { app } = montar();
    const resposta = await desistir(app, { token: 'nao-existe' });
    expect(resposta.status).toBe(400);
  });

  it('sem token: 422 validacao', async () => {
    const { app } = montar();
    expect((await desistir(app, {})).status).toBe(422);
  });
});

describe('rota pública', () => {
  it('fica no limite por IP das rotas públicas (OPS-07)', () => {
    expect(grupoDaRota('/api/conta/desistir')).toBe('publico');
  });
});

describe('ponta a ponta: pedir, confirmar e desistir pelos links dos e-mails', LENTO, () => {
  it('a conta volta a entrar com senha e 2FA', async () => {
    const correio = emailSimulado();
    const pendentes: Promise<unknown>[] = [];
    const app = criarApp({
      capturarErro: () => {},
      email: () => correio.cliente,
      emSegundoPlano: (tarefa) => void pendentes.push(tarefa),
    });
    const conta = await contaComSessao();
    await semearExportacao(conta.usuarioId);
    const tokenDe = (caminho: string) => {
      const texto = correio.enviadas.at(-1)!.texto;
      return new RegExp(`/${caminho}\\?token=([A-Za-z0-9_-]+)`).exec(texto)![1]!;
    };

    await postar(app, '/api/conta/excluir', { senha: conta.senha, declaracao_guarda: true }, conta);
    await Promise.all(pendentes);
    const confirmacao = await postar(app, '/api/conta/excluir/confirmar', {
      token: tokenDe('confirmar-exclusao'),
    });
    expect(confirmacao.status).toBe(200);
    await Promise.all(pendentes);
    const bloqueada = await postar(app, '/api/auth/entrar', {
      email: conta.email,
      senha: conta.senha,
    });
    expect(bloqueada.status).toBe(401);

    const desistencia = await desistir(app, { token: tokenDe('desistir-exclusao') });
    expect(desistencia.status).toBe(200);
    const entrar = await postar(app, '/api/auth/entrar', {
      email: conta.email,
      senha: conta.senha,
    });
    expect(entrar.status).toBe(202);
  });
});
