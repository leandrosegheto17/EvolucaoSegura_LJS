import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ErroEnvioEmail } from '../../src/integracoes/resend.ts';
import { comoAdmin, emailSimulado, emailUnico, novoIp, sha256 } from '../apoio.ts';

// T44 / CAD-01, CAD-02, CAD-03, CAD-06, CAD-08: POST /api/cadastro responde 202 com o mesmo corpo
// para e-mail novo, já confirmado e pendente, e manda o e-mail certo em cada caso:
// - novo: cria a conta pendente e envia o link de confirmação;
// - confirmado: não mexe na conta e envia "você já tem conta" com o link de recuperação;
// - pendente: troca nome e senha, invalida o token anterior e envia um link novo.
// Token de confirmação: 256 bits, só o SHA-256 no banco, válido por 30 minutos.
// Falha do Resend: o mesmo 202, com o erro no Sentry.

const SENHA = 'cavalo-bateria-grampo-7';
const URL_PUBLICA = 'http://localhost:8787';

function montar() {
  const email = emailSimulado();
  const capturarErro = vi.fn();
  const app = criarApp({ email: () => email.cliente, capturarErro });
  const cadastrar = async (corpo: unknown) => {
    const resposta = await app.request(
      '/api/cadastro',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': novoIp() },
        body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      },
      env,
    );
    return {
      status: resposta.status,
      tipo: resposta.headers.get('content-type'),
      corpo: await resposta.text(),
    };
  };
  return { app, email, capturarErro, cadastrar };
}

const dados = (email: string, extra: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza',
  email,
  senha: SENHA,
  aceite_termos: true,
  ...extra,
});

const tokenDoLink = (texto: string, caminho: string): string => {
  const achado = new RegExp(`${URL_PUBLICA}${caminho}\\?token=([A-Za-z0-9_-]+)`).exec(texto);
  if (!achado) throw new Error(`link ${caminho} não encontrado no e-mail`);
  return achado[1]!;
};

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  confirmado_em: Date | null;
}
const usuarioPorEmail = async (email: string) =>
  (await comoAdmin<LinhaUsuario>('select * from usuario where email = $1', [email]))[0];

interface LinhaToken {
  token_hash: Buffer;
  tipo: string;
  criado_em: Date;
  expira_em: Date;
  usado_em: Date | null;
  invalidado_em: Date | null;
}
const tokensDe = (usuarioId: string) =>
  comoAdmin<LinhaToken>('select * from token_email where usuario_id = $1 order by criado_em', [
    usuarioId,
  ]);

const senhaConfere = async (email: string, senha: string) =>
  (
    await comoAdmin<{ ok: boolean }>(
      `select crypt($2, c.hash) = c.hash as ok from credencial_senha c
       join usuario u on u.id = c.usuario_id where u.email = $1`,
      [email, senha],
    )
  )[0]?.ok;

async function criarContaConfirmada(email: string): Promise<string> {
  const [linha] = await comoAdmin<{ id: string }>(
    "insert into usuario (email, nome, confirmado_em) values ($1, 'Dona da Conta', now()) returning id",
    [email],
  );
  await comoAdmin('select definir_senha($1, $2)', [linha!.id, 'senha-original-forte-1']);
  return linha!.id;
}

describe('e-mail novo (CAD-01, CAD-03)', () => {
  it('responde 202 e cria a conta pendente com a senha só como hash', async () => {
    const { cadastrar } = montar();
    const email = emailUnico();

    const resposta = await cadastrar(dados(email));

    expect(resposta.status).toBe(202);
    expect(JSON.parse(resposta.corpo)).toEqual({ status: 'aceito' });
    expect(await usuarioPorEmail(email)).toMatchObject({
      nome: 'Ana Souza',
      email,
      confirmado_em: null,
    });
    const [credencial] = await comoAdmin<{ hash: string }>(
      'select c.hash from credencial_senha c join usuario u on u.id = c.usuario_id where u.email = $1',
      [email],
    );
    expect(credencial!.hash).toMatch(/^\$2a\$12\$/);
    expect(await senhaConfere(email, SENHA)).toBe(true);
  });

  it('envia o link de confirmação ao e-mail cadastrado', async () => {
    const { cadastrar, email: correio } = montar();
    const email = emailUnico();

    await cadastrar(dados(email));

    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]!.para).toBe(email);
    expect(correio.enviadas[0]!.texto).toContain(`${URL_PUBLICA}/confirmar?token=`);
  });

  it('token de 256 bits, só o SHA-256 no banco, válido por 30 minutos', async () => {
    const { cadastrar, email: correio } = montar();
    const email = emailUnico();

    await cadastrar(dados(email));
    const token = tokenDoLink(correio.enviadas[0]!.texto, '/confirmar');
    const usuario = await usuarioPorEmail(email);
    const tokens = await tokensDe(usuario!.id);

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.tipo).toBe('confirmacao');
    expect(tokens[0]!.token_hash.equals(await sha256(token))).toBe(true);
    expect(tokens[0]!.expira_em.getTime() - tokens[0]!.criado_em.getTime()).toBe(30 * 60_000);
  });

  it('cada cadastro gera um token diferente', async () => {
    const { cadastrar, email: correio } = montar();
    await cadastrar(dados(emailUnico()));
    await cadastrar(dados(emailUnico()));

    const [a, b] = correio.enviadas.map((m) => tokenDoLink(m.texto, '/confirmar'));
    expect(a).not.toBe(b);
  });

  it('guarda o e-mail aparado e em minúsculas', async () => {
    const { cadastrar } = montar();
    const email = emailUnico('maiusculas');

    await cadastrar(dados(`  ${email.toUpperCase()} `));

    expect(await usuarioPorEmail(email)).toBeDefined();
  });
});

describe('e-mail já confirmado (CAD-02)', () => {
  it('responde o mesmo 202 e envia "você já tem conta" com o link de recuperação', async () => {
    const { cadastrar, email: correio } = montar();
    const email = emailUnico('confirmada');
    await criarContaConfirmada(email);

    const resposta = await cadastrar(
      dados(email, { nome: 'Invasor', senha: 'outra-senha-forte-2' }),
    );

    expect(resposta.status).toBe(202);
    expect(JSON.parse(resposta.corpo)).toEqual({ status: 'aceito' });
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]!.para).toBe(email);
    expect(correio.enviadas[0]!.assunto).toMatch(/já tem conta/i);
    expect(correio.enviadas[0]!.texto).toContain(`${URL_PUBLICA}/recuperar`);
    expect(correio.enviadas[0]!.texto).not.toContain('/confirmar');
  });

  it('não altera nome, senha nem cria token da conta confirmada', async () => {
    const { cadastrar } = montar();
    const email = emailUnico('confirmada');
    const id = await criarContaConfirmada(email);

    await cadastrar(dados(email, { nome: 'Invasor', senha: 'outra-senha-forte-2' }));

    expect((await usuarioPorEmail(email))!.nome).toBe('Dona da Conta');
    expect(await senhaConfere(email, 'senha-original-forte-1')).toBe(true);
    expect(await senhaConfere(email, 'outra-senha-forte-2')).toBe(false);
    expect(await tokensDe(id)).toEqual([]);
  });

  it('calcula um hash também nesse caso (tempo equivalente ao do e-mail novo)', async () => {
    const { cadastrar } = montar();
    const confirmada = emailUnico('confirmada');
    await criarContaConfirmada(confirmada);
    await cadastrar(dados(emailUnico()));

    const medir = async (corpo: unknown) => {
      const inicio = performance.now();
      await cadastrar(corpo);
      return performance.now() - inicio;
    };
    const novo = await medir(dados(emailUnico()));
    const existente = await medir(dados(confirmada));
    expect(existente).toBeGreaterThan(novo * 0.5);
  });
});

describe('e-mail pendente (CAD-06)', () => {
  it('troca nome e senha pendentes, invalida o token anterior e envia um novo', async () => {
    const { cadastrar, email: correio } = montar();
    const email = emailUnico('pendente');

    await cadastrar(dados(email));
    const resposta = await cadastrar(
      dados(email, { nome: 'Ana Nova', senha: 'senha-nova-bem-forte-3' }),
    );

    expect(resposta.status).toBe(202);
    expect(JSON.parse(resposta.corpo)).toEqual({ status: 'aceito' });
    const usuario = await usuarioPorEmail(email);
    expect(usuario).toMatchObject({ nome: 'Ana Nova', confirmado_em: null });
    expect(await senhaConfere(email, 'senha-nova-bem-forte-3')).toBe(true);
    expect(await senhaConfere(email, SENHA)).toBe(false);

    const [primeiro, segundo] = correio.enviadas.map((m) => tokenDoLink(m.texto, '/confirmar'));
    expect(primeiro).not.toBe(segundo);
    const tokens = await tokensDe(usuario!.id);
    expect(tokens).toHaveLength(2);
    const porHash = async (t: string) => {
      const hash = await sha256(t!);
      return tokens.find((linha) => linha.token_hash.equals(hash));
    };
    expect((await porHash(primeiro!))!.invalidado_em).not.toBeNull();
    expect((await porHash(segundo!))!.invalidado_em).toBeNull();
  });
});

describe('mesma resposta nos três casos (CAD-01, CAD-02, CAD-06)', () => {
  it('mesmo status, mesmo corpo e mesmo tipo de conteúdo', async () => {
    const { cadastrar } = montar();
    const confirmada = emailUnico('confirmada');
    await criarContaConfirmada(confirmada);
    const pendente = emailUnico('pendente');
    await cadastrar(dados(pendente));

    const respostas = [
      await cadastrar(dados(emailUnico())),
      await cadastrar(dados(confirmada)),
      await cadastrar(dados(pendente)),
    ];

    expect(new Set(respostas.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(respostas[0]).toEqual({
      status: 202,
      tipo: 'application/json',
      corpo: '{"status":"aceito"}',
    });
  });
});

describe('falha do Resend (CAD-08)', () => {
  it('responde o mesmo 202 e manda o erro ao Sentry, mantendo a conta pendente', async () => {
    const { cadastrar, email: correio, capturarErro } = montar();
    const email = emailUnico('sem-correio');
    const erro = new ErroEnvioEmail('falha', 500);
    correio.falhar(erro);

    const resposta = await cadastrar(dados(email));

    expect(resposta).toEqual({
      status: 202,
      tipo: 'application/json',
      corpo: '{"status":"aceito"}',
    });
    expect(capturarErro).toHaveBeenCalledWith(erro);
    const usuario = await usuarioPorEmail(email);
    expect(usuario).toMatchObject({ confirmado_em: null });
    expect(await tokensDe(usuario!.id)).toHaveLength(1);
  });

  it('o mesmo vale para a conta confirmada (sem revelar nada)', async () => {
    const { cadastrar, email: correio, capturarErro } = montar();
    const email = emailUnico('confirmada');
    await criarContaConfirmada(email);
    correio.falhar(new ErroEnvioEmail('limite', 429));

    const resposta = await cadastrar(dados(email));

    expect(resposta.corpo).toBe('{"status":"aceito"}');
    expect(resposta.status).toBe(202);
    expect(capturarErro).toHaveBeenCalledTimes(1);
  });

  it('configuração do Resend ausente também responde 202 e vai ao Sentry', async () => {
    const capturarErro = vi.fn();
    const app = criarApp({ capturarErro });
    const email = emailUnico('sem-chave');

    const resposta = await app.request(
      '/api/cadastro',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': novoIp() },
        body: JSON.stringify(dados(email)),
      },
      env,
    );

    expect(resposta.status).toBe(202);
    expect(await resposta.json()).toEqual({ status: 'aceito' });
    expect(capturarErro).toHaveBeenCalledTimes(1);
  });
});

describe('validação e política de senha (CAD-01, AUTH-11)', () => {
  it.each([
    ['curta', 'curta123'],
    ['longa', 'x1'.repeat(65)],
    ['comum', 'qwerty123456'],
  ])('senha %s: 422 senha_fora_da_politica sem gravar nada', async (motivo, senha) => {
    const { cadastrar, email: correio } = montar();
    const email = emailUnico('senha-ruim');

    const resposta = await cadastrar(dados(email, { senha }));

    expect(resposta.status).toBe(422);
    expect(resposta.tipo).toContain('application/problem+json');
    expect(JSON.parse(resposta.corpo)).toEqual({
      tipo: 'about:blank',
      titulo: 'Senha fora da política',
      status: 422,
      codigo: 'senha_fora_da_politica',
      motivo,
    });
    expect(await usuarioPorEmail(email)).toBeUndefined();
    expect(correio.enviadas).toEqual([]);
  });

  it.each([
    ['sem aceite dos termos', { aceite_termos: false }, ['aceite_termos']],
    ['nome vazio', { nome: '  ' }, ['nome']],
    ['nome com 201 caracteres', { nome: 'a'.repeat(201) }, ['nome']],
    ['e-mail inválido', { email: 'ana@' }, ['email']],
    ['chave desconhecida', { plano: 'pro' }, ['plano']],
  ])('%s: 422 validacao com o campo, sem gravar nada', async (_rotulo, extra, campos) => {
    const { cadastrar, email: correio } = montar();
    const email = emailUnico('invalido');

    const resposta = await cadastrar(dados(email, extra));

    expect(resposta.status).toBe(422);
    expect(JSON.parse(resposta.corpo)).toEqual({
      tipo: 'about:blank',
      titulo: 'Dados inválidos',
      status: 422,
      codigo: 'validacao',
      campos,
    });
    expect(await usuarioPorEmail(email)).toBeUndefined();
    expect(correio.enviadas).toEqual([]);
  });

  it('corpo que não é JSON: 422 validacao', async () => {
    const { cadastrar } = montar();
    const resposta = await cadastrar('{nao é json');
    expect(resposta.status).toBe(422);
    expect(JSON.parse(resposta.corpo)).toMatchObject({ codigo: 'validacao' });
  });

  it('a resposta de erro não ecoa a senha nem o e-mail', async () => {
    const { cadastrar } = montar();
    const email = emailUnico('eco');
    const resposta = await cadastrar(dados(email, { senha: 'qwerty123456' }));
    expect(resposta.corpo).not.toContain('qwerty123456');
    expect(resposta.corpo).not.toContain(email);
  });
});

// SEC-006 (T217): o e-mail não repete o nome digitado. Senão, quem cadastra o e-mail de outra
// pessoa manda a ela um texto qualquer (phishing) assinado pelo domínio do app.
describe('e-mail de cadastro sem eco do nome (SEC-006)', () => {
  const NOMES_DO_ATACANTE = [
    'Sua conta foi suspensa. https://golpe.exemplo',
    'Ana\nSua conta foi suspensa. Regularize em https://golpe.exemplo/pagar',
  ];
  const TRECHOS = ['golpe.exemplo', 'Sua conta foi suspensa', 'Regularize'];

  const semEco = (mensagem: unknown) => {
    const tudo = JSON.stringify(mensagem);
    for (const trecho of TRECHOS) expect(tudo).not.toContain(trecho);
  };

  it.each(NOMES_DO_ATACANTE)('e-mail novo: a confirmação não traz o nome %j', async (nome) => {
    const { cadastrar, email: correio } = montar();
    const email = emailUnico('eco-nome');

    const resposta = await cadastrar(dados(email, { nome }));

    expect(resposta.status).toBe(202);
    expect(JSON.parse(resposta.corpo)).toEqual({ status: 'aceito' });
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]!.texto.split('\n')[0]).toBe('Olá.');
    expect(correio.enviadas[0]!.texto).toContain(`${URL_PUBLICA}/confirmar?token=`);
    semEco(correio.enviadas[0]);
  });

  it.each(NOMES_DO_ATACANTE)('pendente: o novo link não traz o nome %j', async (nome) => {
    const { cadastrar, email: correio } = montar();
    const email = emailUnico('eco-pendente');
    await cadastrar(dados(email));

    const resposta = await cadastrar(dados(email, { nome }));

    expect(resposta.status).toBe(202);
    expect(correio.enviadas).toHaveLength(2);
    expect(correio.enviadas[1]!.texto).toContain(`${URL_PUBLICA}/confirmar?token=`);
    semEco(correio.enviadas[1]);
  });

  it.each(NOMES_DO_ATACANTE)(
    'conta confirmada: "você já tem conta" não traz o nome %j',
    async (nome) => {
      const { cadastrar, email: correio } = montar();
      const email = emailUnico('eco-confirmada');
      await criarContaConfirmada(email);

      const resposta = await cadastrar(dados(email, { nome }));

      expect(resposta.status).toBe(202);
      expect(correio.enviadas).toHaveLength(1);
      expect(correio.enviadas[0]!.assunto).toBe('Você já tem conta no Evolução Segura');
      semEco(correio.enviadas[0]);
    },
  );
});
