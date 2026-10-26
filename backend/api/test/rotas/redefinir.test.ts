import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, criarConta, emailSimulado, ipUnico, sha256 } from '../apoio.ts';

// T55 / AUTH-14, AUTH-15: POST /api/auth/recuperar/confirmar com o token do link e a senha nova.
// - token inválido (desconhecido, vencido, usado, invalidado ou de outro tipo): 400 link_invalido,
//   antes de avaliar a senha (mesmo com a senha fraca);
// - token válido e senha fora da política: 422 senha_fora_da_politica com o motivo;
// - token válido e senha boa: troca o hash, encerra todas as sessões do profissional e responde 204
//   sem abrir sessão. O token usado não vale de novo.

const LENTO = { timeout: 30_000 };
const SENHA_NOVA = 'girassol-lanterna-ponte-9';

function montar() {
  const correio = emailSimulado();
  const app = criarApp({ email: () => correio.cliente, capturarErro: () => {} });
  const redefinir = async (corpo: unknown, headers: Record<string, string> = {}) => {
    const resposta = await app.request(
      '/api/auth/recuperar/confirmar',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          ...headers,
        },
        body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      },
      env,
    );
    return {
      status: resposta.status,
      cookie: resposta.headers.get('set-cookie'),
      corpo: await resposta.text(),
    };
  };
  return { redefinir };
}

// Token de recuperação semeado direto no banco (só o SHA-256), com o estado pedido.
async function semearToken(
  usuarioId: string,
  opcoes: {
    tipo?: string;
    vencido?: boolean;
    usado?: boolean;
    invalidado?: boolean;
  } = {},
): Promise<string> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await comoAdmin(
    `insert into token_email (usuario_id, tipo, token_hash, criado_em, expira_em, usado_em, invalidado_em)
     values ($1, $2, $3, now() - interval '40 minutes',
       case when $4 then now() - interval '10 minutes' else now() + interval '20 minutes' end,
       case when $5 then now() end, case when $6 then now() end)`,
    [
      usuarioId,
      opcoes.tipo ?? 'recuperacao',
      await sha256(token),
      opcoes.vencido ?? false,
      opcoes.usado ?? false,
      opcoes.invalidado ?? false,
    ],
  );
  return token;
}

const senhaConfere = async (usuarioId: string, senha: string) =>
  (
    await comoAdmin<{ ok: boolean }>(
      'select crypt($2, hash) = hash as ok from credencial_senha where usuario_id = $1',
      [usuarioId, senha],
    )
  )[0]?.ok;

const hashDaSenha = async (usuarioId: string) =>
  (
    await comoAdmin<{ hash: string }>('select hash from credencial_senha where usuario_id = $1', [
      usuarioId,
    ])
  )[0]!.hash;

async function abrirSessao(usuarioId: string): Promise<Buffer> {
  const hash = await sha256(crypto.randomUUID());
  await comoAdmin('insert into sessao (usuario_id, token_hash) values ($1, $2)', [usuarioId, hash]);
  return hash;
}

const sessoesAbertas = async (usuarioId: string) =>
  comoAdmin('select id from sessao where usuario_id = $1 and encerrada_em is null', [usuarioId]);

const PROBLEMA_LINK = {
  tipo: 'about:blank',
  titulo: 'Link inválido',
  status: 400,
  codigo: 'link_invalido',
};

describe('token inválido (AUTH-15)', LENTO, () => {
  it.each([
    ['vencido', { vencido: true }],
    ['já usado', { usado: true }],
    ['invalidado por um pedido novo', { invalidado: true }],
    ['de outro tipo (confirmação)', { tipo: 'confirmacao' }],
  ])('token %s: 400 link_invalido sem trocar a senha', async (_rotulo, estado) => {
    const { redefinir } = montar();
    const conta = await criarConta();
    const token = await semearToken(conta.id, estado);
    const antes = await hashDaSenha(conta.id);

    const resposta = await redefinir({ token, nova_senha: SENHA_NOVA });

    expect(resposta.status).toBe(400);
    expect(JSON.parse(resposta.corpo)).toEqual(PROBLEMA_LINK);
    expect(await hashDaSenha(conta.id)).toBe(antes);
  });

  it.each([
    ['desconhecido', 'nao-existe-este-token'],
    ['vazio', ''],
  ])('token %s: 400 link_invalido', async (_rotulo, token) => {
    const { redefinir } = montar();
    const resposta = await redefinir({ token, nova_senha: SENHA_NOVA });
    expect(resposta.status).toBe(400);
    expect(JSON.parse(resposta.corpo)).toEqual(PROBLEMA_LINK);
  });

  it.each([
    ['curta', 'curta123'],
    ['comum', 'qwerty123456'],
  ])(
    'token inválido com senha %s: 400 link_invalido, não 422 (token antes da política)',
    async (_motivo, senha) => {
      const { redefinir } = montar();
      const conta = await criarConta();
      const vencido = await semearToken(conta.id, { vencido: true });

      const desconhecido = await redefinir({ token: 'nao-existe', nova_senha: senha });
      const expirado = await redefinir({ token: vencido, nova_senha: senha });

      expect(desconhecido.status).toBe(400);
      expect(JSON.parse(desconhecido.corpo)).toEqual(PROBLEMA_LINK);
      expect(expirado.status).toBe(400);
      expect(JSON.parse(expirado.corpo)).toEqual(PROBLEMA_LINK);
    },
  );

  it('não encerra as sessões quando o link é inválido', async () => {
    const { redefinir } = montar();
    const conta = await criarConta();
    await abrirSessao(conta.id);
    const token = await semearToken(conta.id, { vencido: true });

    await redefinir({ token, nova_senha: SENHA_NOVA });

    expect(await sessoesAbertas(conta.id)).toHaveLength(1);
  });
});

describe('senha nova fora da política (AUTH-11, AUTH-14)', LENTO, () => {
  it.each([
    ['curta', 'curta123'],
    ['longa', 'x1'.repeat(65)],
    ['comum', 'qwerty123456'],
  ])('senha %s com token válido: 422 com o motivo, sem trocar nada', async (motivo, senha) => {
    const { redefinir } = montar();
    const conta = await criarConta();
    await abrirSessao(conta.id);
    const token = await semearToken(conta.id);
    const antes = await hashDaSenha(conta.id);

    const resposta = await redefinir({ token, nova_senha: senha });

    expect(resposta.status).toBe(422);
    expect(JSON.parse(resposta.corpo)).toEqual({
      tipo: 'about:blank',
      titulo: 'Senha fora da política',
      status: 422,
      codigo: 'senha_fora_da_politica',
      motivo,
    });
    expect(await hashDaSenha(conta.id)).toBe(antes);
    expect(await sessoesAbertas(conta.id)).toHaveLength(1);
  });

  it('a senha recusada não gasta o link: a segunda tentativa, com senha boa, funciona', async () => {
    const { redefinir } = montar();
    const conta = await criarConta();
    const token = await semearToken(conta.id);

    const fraca = await redefinir({ token, nova_senha: 'qwerty123456' });
    const boa = await redefinir({ token, nova_senha: SENHA_NOVA });

    expect(fraca.status).toBe(422);
    expect(boa.status).toBe(204);
  });
});

describe('redefinição com token válido (AUTH-14)', LENTO, () => {
  it('responde 204 vazio, sem cookie de sessão', async () => {
    const { redefinir } = montar();
    const conta = await criarConta();
    const token = await semearToken(conta.id);

    const resposta = await redefinir({ token, nova_senha: SENHA_NOVA });

    expect(resposta.status).toBe(204);
    expect(resposta.corpo).toBe('');
    expect(resposta.cookie).toBeNull();
  });

  it('não cria sessão nova', async () => {
    const { redefinir } = montar();
    const conta = await criarConta();
    const token = await semearToken(conta.id);

    await redefinir({ token, nova_senha: SENHA_NOVA });

    expect(await comoAdmin('select id from sessao where usuario_id = $1', [conta.id])).toEqual([]);
  });

  it('troca o hash: a senha nova confere (bcrypt 12) e a antiga não', async () => {
    const { redefinir } = montar();
    const conta = await criarConta();
    const token = await semearToken(conta.id);

    await redefinir({ token, nova_senha: SENHA_NOVA });

    expect(await senhaConfere(conta.id, SENHA_NOVA)).toBe(true);
    expect(await senhaConfere(conta.id, conta.senha)).toBe(false);
    expect(await hashDaSenha(conta.id)).toMatch(/^\$2a\$12\$/);
  });

  it('encerra todas as sessões abertas do profissional, sem apagar as linhas', async () => {
    const { redefinir } = montar();
    const conta = await criarConta();
    await abrirSessao(conta.id);
    await abrirSessao(conta.id);
    await abrirSessao(conta.id);
    const token = await semearToken(conta.id);

    await redefinir({ token, nova_senha: SENHA_NOVA });

    expect(await sessoesAbertas(conta.id)).toEqual([]);
    const todas = await comoAdmin<{ encerrada_em: Date | null }>(
      'select encerrada_em from sessao where usuario_id = $1',
      [conta.id],
    );
    expect(todas).toHaveLength(3);
    expect(todas.every((s) => s.encerrada_em !== null)).toBe(true);
  });

  it('não mexe nas sessões de outro profissional', async () => {
    const { redefinir } = montar();
    const conta = await criarConta();
    const outra = await criarConta();
    await abrirSessao(outra.id);
    const token = await semearToken(conta.id);

    await redefinir({ token, nova_senha: SENHA_NOVA });

    expect(await sessoesAbertas(outra.id)).toHaveLength(1);
  });

  it('o token usado não vale de novo', async () => {
    const { redefinir } = montar();
    const conta = await criarConta();
    const token = await semearToken(conta.id);

    const primeira = await redefinir({ token, nova_senha: SENHA_NOVA });
    const segunda = await redefinir({ token, nova_senha: 'outra-senha-bem-forte-4' });

    expect(primeira.status).toBe(204);
    expect(segunda.status).toBe(400);
    expect(JSON.parse(segunda.corpo)).toEqual(PROBLEMA_LINK);
    expect(await senhaConfere(conta.id, SENHA_NOVA)).toBe(true);
    const [linha] = await comoAdmin<{ usado_em: Date | null }>(
      'select usado_em from token_email where token_hash = $1',
      [await sha256(token)],
    );
    expect(linha!.usado_em).not.toBeNull();
  });

  it('ponta a ponta: o link do pedido (T54) redefine a senha', async () => {
    const correio = emailSimulado();
    const pendentes: Promise<unknown>[] = [];
    const app = criarApp({
      email: () => correio.cliente,
      capturarErro: () => {},
      emSegundoPlano: (tarefa) => void pendentes.push(tarefa),
    });
    const conta = await criarConta();
    const post = (caminho: string, corpo: unknown) =>
      app.request(
        caminho,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ipUnico() },
          body: JSON.stringify(corpo),
        },
        env,
      );

    await post('/api/auth/recuperar', { email: conta.email });
    await Promise.all(pendentes);
    const token = /\/redefinir\?token=([A-Za-z0-9_-]+)/.exec(correio.enviadas[0]!.texto)![1]!;
    const resposta = await post('/api/auth/recuperar/confirmar', { token, nova_senha: SENHA_NOVA });

    expect(resposta.status).toBe(204);
    expect(await senhaConfere(conta.id, SENHA_NOVA)).toBe(true);
  });
});

describe('validação (AUTH-14)', () => {
  it.each([
    ['sem token', { nova_senha: SENHA_NOVA }, ['token']],
    ['sem senha nova', { token: 'abc' }, ['nova_senha']],
    ['chave desconhecida', { token: 'abc', nova_senha: SENHA_NOVA, email: 'a@b.com' }, ['email']],
  ])('%s: 422 validacao', async (_rotulo, corpo, campos) => {
    const { redefinir } = montar();
    const resposta = await redefinir(corpo);
    expect(resposta.status).toBe(422);
    expect(JSON.parse(resposta.corpo)).toMatchObject({ codigo: 'validacao', campos });
  });

  it('a resposta não ecoa a senha nem o token', async () => {
    const { redefinir } = montar();
    const resposta = await redefinir({ token: 'token-que-nao-existe', nova_senha: 'qwerty123456' });
    expect(resposta.corpo).not.toContain('qwerty123456');
    expect(resposta.corpo).not.toContain('token-que-nao-existe');
  });
});
