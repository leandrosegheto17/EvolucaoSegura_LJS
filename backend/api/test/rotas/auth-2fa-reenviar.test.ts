import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ErroEnvioEmail } from '../../src/integracoes/resend.ts';
import { comoAdmin, criarConta, emailSimulado, emailUnico, ipUnico } from '../apoio.ts';

// T49 / AUTH-06: POST /api/auth/2fa/reenviar responde 202 com o mesmo corpo em todos os casos e
// só envia código novo se o último envio tiver mais de 60 segundos, pelo relógio do banco.
// Premissas aceitas: o reenvio cria um desafio novo (o código anterior deixa de valer). PREMISSA
// desta tarefa: só há reenvio para um desafio ainda aberto (a senha já foi conferida, o código não
// foi usado, não venceu e não foi invalidado por 5 erros); sem ele, nada é enviado.

const LENTO = { timeout: 30_000 };

function montar() {
  const correio = emailSimulado();
  const capturarErro = vi.fn();
  const app = criarApp({ email: () => correio.cliente, capturarErro });
  const pedir = (caminho: string, corpo: unknown) =>
    app.request(
      caminho,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ipUnico() },
        body: JSON.stringify(corpo),
      },
      env,
    );
  const ultimoCodigo = () => /\b(\d{6})\b/.exec(correio.enviadas.at(-1)!.texto)![1]!;
  const pedirCodigo = async (conta: { email: string; senha: string }) => {
    const corpo = { email: conta.email, senha: conta.senha };
    expect((await pedir('/api/auth/entrar', corpo)).status).toBe(202);
    return ultimoCodigo();
  };
  const reenviar = async (email: string) => {
    const resposta = await pedir('/api/auth/2fa/reenviar', { email });
    return { status: resposta.status, corpo: await resposta.text() };
  };
  const verificar = async (email: string, codigo: string) =>
    (await pedir('/api/auth/2fa/verificar', { email, codigo })).status;
  return { correio, capturarErro, pedirCodigo, reenviar, verificar, ultimoCodigo };
}

// Recua a criação do desafio no relógio do banco (simula o tempo desde o último envio).
const envioHa = (usuarioId: string, segundos: number) =>
  comoAdmin(
    `update desafio_2fa set criado_em = now() - make_interval(secs => $2)
     where usuario_id = $1 and usado_em is null and invalidado_em is null`,
    [usuarioId, segundos],
  );

afterEach(() => {
  vi.useRealTimers();
});

describe('intervalo de 60 segundos (AUTH-06)', LENTO, () => {
  it('59 s depois do último envio não envia', async () => {
    const { pedirCodigo, reenviar, correio } = montar();
    const conta = await criarConta();
    await pedirCodigo(conta);
    await envioHa(conta.id, 59);

    const resposta = await reenviar(conta.email);

    expect(resposta.status).toBe(202);
    expect(correio.enviadas).toHaveLength(1);
  });

  it('61 s depois envia um código novo ao e-mail da conta, que passa a ser o válido', async () => {
    const { pedirCodigo, reenviar, verificar, correio, ultimoCodigo } = montar();
    const conta = await criarConta();
    const antigo = await pedirCodigo(conta);
    await envioHa(conta.id, 61);

    const resposta = await reenviar(conta.email);

    expect(resposta.status).toBe(202);
    expect(correio.enviadas).toHaveLength(2);
    expect(correio.enviadas[1]!.para).toBe(conta.email);
    const novo = ultimoCodigo();
    if (novo !== antigo) expect(await verificar(conta.email, antigo)).toBe(401);
    expect(await verificar(conta.email, novo)).toBe(200);
  });

  it('o intervalo conta a partir do reenvio mais recente', async () => {
    const { pedirCodigo, reenviar, correio } = montar();
    const conta = await criarConta();
    await pedirCodigo(conta);
    await envioHa(conta.id, 61);
    await reenviar(conta.email);

    await reenviar(conta.email);

    expect(correio.enviadas).toHaveLength(2);
  });
});

describe('relógio do banco, não do Worker (AUTH-06)', LENTO, () => {
  it('relógio do Worker adiantado não libera o reenvio', async () => {
    const { pedirCodigo, reenviar, correio } = montar();
    const conta = await criarConta();
    await pedirCodigo(conta);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * 60_000);

    await reenviar(conta.email);

    expect(correio.enviadas).toHaveLength(1);
  });

  it('relógio do Worker atrasado não impede o reenvio', async () => {
    const { pedirCodigo, reenviar, correio } = montar();
    const conta = await criarConta();
    await pedirCodigo(conta);
    await envioHa(conta.id, 61);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 10 * 60_000);

    await reenviar(conta.email);

    expect(correio.enviadas).toHaveLength(2);
  });
});

describe('corpo idêntico com e sem envio (AUTH-06)', LENTO, () => {
  it('responde o mesmo 202 quando envia, quando é cedo, sem conta e sem desafio aberto', async () => {
    const { pedirCodigo, reenviar, verificar, correio } = montar();
    const comEnvio = await criarConta();
    const cedo = await criarConta();
    const semDesafio = await criarConta();
    const usado = await criarConta();
    await pedirCodigo(comEnvio);
    await envioHa(comEnvio.id, 61);
    await pedirCodigo(cedo);
    expect(await verificar(usado.email, await pedirCodigo(usado))).toBe(200);
    await envioHa(usado.id, 61);
    const enviadasAntes = correio.enviadas.length;

    const respostas = [
      await reenviar(comEnvio.email),
      await reenviar(cedo.email),
      await reenviar(semDesafio.email),
      await reenviar(emailUnico('ninguem')),
      await reenviar(usado.email),
    ];

    for (const resposta of respostas) {
      expect(resposta.status).toBe(202);
      expect(resposta.corpo).toBe(respostas[0]!.corpo);
    }
    expect(JSON.parse(respostas[0]!.corpo)).toEqual({ status: 'aceito' });
    expect(correio.enviadas.slice(enviadasAntes).map((m) => m.para)).toEqual([comEnvio.email]);
  });

  it('desafio invalidado por 5 erros não é reenviado', async () => {
    const { pedirCodigo, reenviar, verificar, correio } = montar();
    const conta = await criarConta();
    const codigo = await pedirCodigo(conta);
    const errado = String((Number(codigo) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 5; i += 1) await verificar(conta.email, errado);
    await comoAdmin(
      "update desafio_2fa set criado_em = now() - interval '61 seconds' where usuario_id = $1",
      [conta.id],
    );

    const resposta = await reenviar(conta.email);

    expect(resposta.status).toBe(202);
    expect(correio.enviadas).toHaveLength(1);
  });

  it('falha do e-mail no reenvio: o mesmo 202, vai ao Sentry e o código anterior segue valendo', async () => {
    const { pedirCodigo, reenviar, verificar, correio, capturarErro } = montar();
    const conta = await criarConta();
    const codigo = await pedirCodigo(conta);
    await envioHa(conta.id, 61);
    const erro = new ErroEnvioEmail('falha', 500);
    correio.falhar(erro);

    const resposta = await reenviar(conta.email);

    expect(resposta).toEqual({ status: 202, corpo: JSON.stringify({ status: 'aceito' }) });
    expect(capturarErro).toHaveBeenCalledWith(erro);
    expect(await verificar(conta.email, codigo)).toBe(200);
  });

  it('corpo inválido responde 422 validacao', async () => {
    const { reenviar } = montar();

    const resposta = await reenviar('nao-e-email');

    expect(resposta.status).toBe(422);
    expect(JSON.parse(resposta.corpo)).toMatchObject({ codigo: 'validacao' });
  });
});
