import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ErroEnvioEmail } from '../../src/integracoes/resend.ts';
import { comoAdmin, criarConta, emailSimulado, emailUnico, ipUnico, sha256 } from '../apoio.ts';

// T54 / AUTH-13: POST /api/auth/recuperar responde 202 vazio em todos os casos. Se a conta existe,
// envia o link de redefinição com um token de 256 bits, guardado só como SHA-256, válido por 30
// minutos e de uso único, e invalida os pedidos anteriores ainda abertos. A falha do envio vai ao
// Sentry e não muda a resposta.

const LENTO = { timeout: 30_000 };
const URL_PUBLICA = 'http://localhost:8787';

function montar() {
  const correio = emailSimulado();
  const capturarErro = vi.fn();
  // O envio sai em segundo plano: os testes guardam as tarefas e esperam por elas.
  const pendentes: Promise<unknown>[] = [];
  const app = criarApp({
    email: () => correio.cliente,
    capturarErro,
    emSegundoPlano: (tarefa) => void pendentes.push(tarefa),
  });
  const pedir = async (corpo: unknown) => {
    const resposta = await app.request(
      '/api/auth/recuperar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ipUnico() },
        body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      },
      env,
    );
    await Promise.all(pendentes);
    return {
      status: resposta.status,
      tipo: resposta.headers.get('content-type'),
      corpo: await resposta.text(),
    };
  };
  return { correio, capturarErro, pedir };
}

const tokenDoLink = (texto: string): string => {
  const achado = new RegExp(`${URL_PUBLICA}/redefinir\\?token=([A-Za-z0-9_-]+)`).exec(texto);
  if (!achado) throw new Error('link /redefinir não encontrado no e-mail');
  return achado[1]!;
};

interface LinhaToken {
  token_hash: Buffer;
  tipo: string;
  criado_em: Date;
  expira_em: Date;
  usado_em: Date | null;
  invalidado_em: Date | null;
}
const tokensDe = (usuarioId: string, tipo = 'recuperacao') =>
  comoAdmin<LinhaToken>(
    'select * from token_email where usuario_id = $1 and tipo = $2 order by criado_em',
    [usuarioId, tipo],
  );

describe('conta existente (AUTH-13)', LENTO, () => {
  it('responde 202 vazio e envia o link de redefinição ao e-mail da conta', async () => {
    const { pedir, correio } = montar();
    const conta = await criarConta();

    const resposta = await pedir({ email: conta.email });

    expect(resposta.status).toBe(202);
    expect(resposta.corpo).toBe('');
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]!.para).toBe(conta.email);
    expect(correio.enviadas[0]!.texto).toContain(`${URL_PUBLICA}/redefinir?token=`);
  });

  it('token de 256 bits, só o SHA-256 no banco, válido por 30 minutos e ainda não usado', async () => {
    const { pedir, correio } = montar();
    const conta = await criarConta();

    await pedir({ email: conta.email });
    const token = tokenDoLink(correio.enviadas[0]!.texto);
    const tokens = await tokensDe(conta.id);

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.token_hash.equals(await sha256(token))).toBe(true);
    expect(tokens[0]!.token_hash.equals(Buffer.from(token))).toBe(false);
    expect(tokens[0]!.expira_em.getTime() - tokens[0]!.criado_em.getTime()).toBe(30 * 60_000);
    expect(tokens[0]).toMatchObject({ usado_em: null, invalidado_em: null });
  });

  it('o token em claro não aparece em nenhuma coluna do banco', async () => {
    const { pedir, correio } = montar();
    const conta = await criarConta();

    await pedir({ email: conta.email });
    const token = tokenDoLink(correio.enviadas[0]!.texto);
    const [achado] = await comoAdmin<{ total: string }>(
      `select count(*) as total from token_email t
       where t.usuario_id = $1 and (encode(t.token_hash, 'escape') like '%' || $2 || '%'
         or t::text like '%' || $2 || '%')`,
      [conta.id, token],
    );
    expect(achado!.total).toBe('0');
  });

  it('aceita o e-mail com maiúsculas e espaços (mesma conta)', async () => {
    const { pedir, correio } = montar();
    const conta = await criarConta();

    await pedir({ email: `  ${conta.email.toUpperCase()} ` });

    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]!.para).toBe(conta.email);
  });

  it('cada pedido gera um token diferente', async () => {
    const { pedir, correio } = montar();
    const conta = await criarConta();

    await pedir({ email: conta.email });
    await pedir({ email: conta.email });

    const [a, b] = correio.enviadas.map((m) => tokenDoLink(m.texto));
    expect(a).not.toBe(b);
  });
});

describe('novo pedido invalida o anterior (AUTH-13)', LENTO, () => {
  it('o token anterior fica invalidado e só o novo vale', async () => {
    const { pedir, correio } = montar();
    const conta = await criarConta();

    await pedir({ email: conta.email });
    await pedir({ email: conta.email });

    const [primeiro, segundo] = correio.enviadas.map((m) => tokenDoLink(m.texto));
    const tokens = await tokensDe(conta.id);
    expect(tokens).toHaveLength(2);
    const porToken = async (t: string) => {
      const hash = await sha256(t);
      return tokens.find((linha) => linha.token_hash.equals(hash));
    };
    expect((await porToken(primeiro!))!.invalidado_em).not.toBeNull();
    expect((await porToken(segundo!))!.invalidado_em).toBeNull();
  });

  it('não mexe nos tokens de outros tipos (ex.: confirmação)', async () => {
    const { pedir } = montar();
    const conta = await criarConta();
    await comoAdmin(
      `insert into token_email (usuario_id, tipo, token_hash, expira_em)
       values ($1, 'confirmacao', $2, now() + interval '30 minutes')`,
      [conta.id, await sha256(crypto.randomUUID())],
    );

    await pedir({ email: conta.email });

    const [confirmacao] = await tokensDe(conta.id, 'confirmacao');
    expect(confirmacao!.invalidado_em).toBeNull();
  });
});

describe('mesma resposta em todos os casos (AUTH-13)', LENTO, () => {
  it('conta existente e e-mail inexistente: mesmo status, corpo vazio e mesmos cabeçalhos de conteúdo', async () => {
    const { pedir, correio } = montar();
    const conta = await criarConta();

    const existente = await pedir({ email: conta.email });
    const inexistente = await pedir({ email: emailUnico('ninguem') });

    expect(existente).toEqual(inexistente);
    expect(existente.status).toBe(202);
    expect(existente.corpo).toBe('');
    expect(correio.enviadas).toHaveLength(1);
  });

  it('e-mail inexistente não envia nada nem cria token', async () => {
    const { pedir, correio } = montar();
    const email = emailUnico('ninguem');

    const resposta = await pedir({ email });

    expect(resposta.status).toBe(202);
    expect(correio.enviadas).toEqual([]);
    const linhas = await comoAdmin('select 1 from usuario where email = $1', [email]);
    expect(linhas).toEqual([]);
  });

  it('conta pendente ou bloqueada para exclusão: mesmo 202 vazio, sem e-mail e sem token', async () => {
    const { pedir, correio } = montar();
    const pendente = await criarConta({ confirmada: false });
    const bloqueada = await criarConta({ bloqueada: true });
    const referencia = await pedir({ email: emailUnico('ninguem') });

    expect(await pedir({ email: pendente.email })).toEqual(referencia);
    expect(await pedir({ email: bloqueada.email })).toEqual(referencia);
    expect(correio.enviadas).toEqual([]);
    expect(await tokensDe(pendente.id)).toEqual([]);
    expect(await tokensDe(bloqueada.id)).toEqual([]);
  });

  it('falha do envio: o mesmo 202 vazio e o erro vai ao Sentry', async () => {
    const { pedir, correio, capturarErro } = montar();
    const conta = await criarConta();
    const erro = new ErroEnvioEmail('falha', 500);
    correio.falhar(erro);
    const referencia = await pedir({ email: emailUnico('ninguem') });

    const resposta = await pedir({ email: conta.email });

    expect(resposta).toEqual(referencia);
    expect(capturarErro).toHaveBeenCalledWith(erro);
  });

  it('a resposta não espera o envio do e-mail (sai em segundo plano)', async () => {
    const correio = emailSimulado();
    const tarefas: Promise<unknown>[] = [];
    let liberar = () => {};
    const travado = new Promise<void>((pronto) => (liberar = pronto));
    const app = criarApp({
      email: () => ({
        enviar: async (mensagem) => {
          await travado;
          await correio.cliente.enviar(mensagem);
        },
      }),
      capturarErro: () => {},
      emSegundoPlano: (tarefa) => void tarefas.push(tarefa),
    });
    const conta = await criarConta();

    const resposta = await app.request(
      '/api/auth/recuperar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ipUnico() },
        body: JSON.stringify({ email: conta.email }),
      },
      env,
    );

    expect(resposta.status).toBe(202);
    expect(correio.enviadas).toEqual([]);
    expect(tarefas).toHaveLength(1);
    liberar();
    await Promise.all(tarefas);
    expect(correio.enviadas).toHaveLength(1);
  });
});

describe('validação (AUTH-13)', () => {
  it.each([
    ['e-mail inválido', { email: 'ana@' }, ['email']],
    ['chave desconhecida', { email: 'ana@exemplo.com.br', senha: 'x' }, ['senha']],
  ])('%s: 422 validacao sem enviar nada', async (_rotulo, corpo, campos) => {
    const { pedir, correio } = montar();

    const resposta = await pedir(corpo);

    expect(resposta.status).toBe(422);
    expect(JSON.parse(resposta.corpo)).toMatchObject({ codigo: 'validacao', campos });
    expect(correio.enviadas).toEqual([]);
  });

  it('corpo que não é JSON: 422 validacao', async () => {
    const { pedir } = montar();
    const resposta = await pedir('{nao é json');
    expect(resposta.status).toBe(422);
  });
});
