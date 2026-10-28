import { env } from 'cloudflare:workers';
import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { grupoDaRota } from '../../src/middleware/limite.ts';
import { comoAdmin, emailSimulado, ipUnico } from '../apoio.ts';
import {
  type App,
  abrirSessao,
  contaComSessao,
  eventosDe,
  postar,
  semearToken,
  tokensDe,
} from './conta-apoio.ts';
import { asaasSimulado } from './plano-apoio.ts';

// T150 / CONTA-03, AUD-04: POST /api/conta/excluir/confirmar, rota pública com o token do link
// do e-mail. Token de exclusão válido (não usado, não invalidado, dentro dos 30 minutos): bloqueia
// a conta (bloqueado_exclusao_em), encerra todas as sessões abertas do profissional, consome o
// token (uso único) e audita conta.exclusao_confirmada; responde 200 com a data da purga (30 dias
// depois do bloqueio). Depois disso o login é recusado com o 401 de sempre (AUTH-02). Token que
// não serve: 400 link_invalido sem mudar nada.

const LENTO = { timeout: 30_000 };
const DIA = 24 * 60 * 60_000;

function montar(): App {
  return criarApp({
    capturarErro: () => {},
    email: () => emailSimulado().cliente,
    asaas: () => asaasSimulado().cliente,
    emSegundoPlano: () => {},
  });
}

const confirmar = (app: App, corpo: unknown) => postar(app, '/api/conta/excluir/confirmar', corpo);

async function estadoDa(usuarioId: string) {
  const [linha] = await comoAdmin<{ bloqueado_exclusao_em: Date | null; abertas: number }>(
    `select u.bloqueado_exclusao_em,
            (select count(*)::int from sessao s
             where s.usuario_id = u.id and s.encerrada_em is null) as abertas
     from usuario u where u.id = $1`,
    [usuarioId],
  );
  return linha!;
}

describe('confirmar com o link válido (CONTA-03)', LENTO, () => {
  it('bloqueia a conta e responde 200 com a data da purga, 30 dias depois', async () => {
    const app = montar();
    const conta = await contaComSessao();
    const token = await semearToken(conta.usuarioId, 'exclusao', 30);

    const resposta = await confirmar(app, { token });

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as { status: string; purga_em: string };
    const { bloqueado_exclusao_em: bloqueio } = await estadoDa(conta.usuarioId);
    expect(bloqueio).toBeInstanceOf(Date);
    expect(corpo).toEqual({
      status: 'bloqueada',
      purga_em: new Date(bloqueio!.getTime() + 30 * DIA).toISOString(),
    });
  });

  it('encerra todas as sessões abertas do profissional e só as dele', async () => {
    const app = montar();
    const conta = await contaComSessao();
    await abrirSessao(conta.usuarioId);
    const outro = await contaComSessao();
    expect((await estadoDa(conta.usuarioId)).abertas).toBe(2);

    await confirmar(app, { token: await semearToken(conta.usuarioId, 'exclusao', 30) });

    expect((await estadoDa(conta.usuarioId)).abertas).toBe(0);
    expect(await estadoDa(outro.usuarioId)).toEqual({ bloqueado_exclusao_em: null, abertas: 1 });
  });

  it('a sessão que estava aberta deixa de valer', async () => {
    const app = montar();
    const conta = await contaComSessao();
    await confirmar(app, { token: await semearToken(conta.usuarioId, 'exclusao', 30) });
    const resposta = await app.request(
      '/api/eu',
      { headers: { cookie: conta.cookie, 'CF-Connecting-IP': ipUnico() } },
      env,
    );
    expect(resposta.status).toBe(401);
  });

  it('login recusado depois de confirmar, com o 401 de sempre', async () => {
    const app = montar();
    const conta = await contaComSessao();
    await confirmar(app, { token: await semearToken(conta.usuarioId, 'exclusao', 30) });
    const resposta = await postar(app, '/api/auth/entrar', {
      email: conta.email,
      senha: conta.senha,
    });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('consome o token: o mesmo link não serve de novo', async () => {
    const app = montar();
    const conta = await contaComSessao();
    const token = await semearToken(conta.usuarioId, 'exclusao', 30);
    expect((await confirmar(app, { token })).status).toBe(200);
    const [linha] = await tokensDe(conta.usuarioId, 'exclusao');
    expect(linha!.usado_em).not.toBeNull();

    const segunda = await confirmar(app, { token });
    expect(segunda.status).toBe(400);
    expect(await segunda.json()).toMatchObject({ codigo: 'link_invalido' });
  });

  it('audita conta.exclusao_confirmada com alvo conta', async () => {
    const app = montar();
    const conta = await contaComSessao();
    await confirmar(app, { token: await semearToken(conta.usuarioId, 'exclusao', 30) });
    expect(await eventosDe(conta.usuarioId)).toEqual([
      {
        ator: conta.usuarioId,
        acao: 'conta.exclusao_confirmada',
        alvo_tipo: 'conta',
        alvo_id: conta.usuarioId,
        campos_alterados: ['bloqueado_exclusao_em'],
        origem_ip: expect.any(String),
        origem_ua: 'Mozilla/5',
      },
    ]);
  });
});

describe('rota pública', () => {
  it('fica no limite por IP das rotas públicas (OPS-07)', () => {
    expect(grupoDaRota('/api/conta/excluir/confirmar')).toBe('publico');
  });
});

describe('link que não serve: 400 link_invalido sem mudar nada', LENTO, () => {
  async function semEfeito(usuarioId: string) {
    expect(await estadoDa(usuarioId)).toEqual({ bloqueado_exclusao_em: null, abertas: 1 });
    expect(await eventosDe(usuarioId)).toEqual([]);
  }

  it.each([
    ['vencido', -1, 'exclusao'],
    ['de recuperação de senha', 30, 'recuperacao'],
    ['de desistência', 30, 'desistencia'],
  ])('%s', async (_caso, minutos, tipo) => {
    const app = montar();
    const conta = await contaComSessao();
    const token = await semearToken(conta.usuarioId, tipo, minutos);
    const resposta = await confirmar(app, { token });
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ codigo: 'link_invalido' });
    await semEfeito(conta.usuarioId);
  });

  it('invalidado por um pedido mais novo', async () => {
    const app = montar();
    const conta = await contaComSessao();
    const token = await semearToken(conta.usuarioId, 'exclusao', 30);
    await comoAdmin('update token_email set invalidado_em = now() where usuario_id = $1', [
      conta.usuarioId,
    ]);
    expect((await confirmar(app, { token })).status).toBe(400);
    await semEfeito(conta.usuarioId);
  });

  it('desconhecido ou malformado', async () => {
    const app = montar();
    for (const token of ['nao-existe', '', 'x'.repeat(512)]) {
      const resposta = await confirmar(app, { token });
      expect(resposta.status, token.slice(0, 10)).toBe(400);
      expect(await resposta.json()).toMatchObject({ codigo: 'link_invalido' });
    }
  });

  it('conta já bloqueada: o link aberto que sobrou não serve', async () => {
    const app = montar();
    const conta = await contaComSessao();
    const token = await semearToken(conta.usuarioId, 'exclusao', 30);
    await comoAdmin('update usuario set bloqueado_exclusao_em = now() where id = $1', [
      conta.usuarioId,
    ]);
    const resposta = await confirmar(app, { token });
    expect(resposta.status).toBe(400);
    expect(await eventosDe(conta.usuarioId)).toEqual([]);
  });

  it('sem token ou com chave a mais: 422 validacao', async () => {
    const app = montar();
    expect((await confirmar(app, {})).status).toBe(422);
    expect((await confirmar(app, { token: 'a', outra: 1 })).status).toBe(422);
  });
});
