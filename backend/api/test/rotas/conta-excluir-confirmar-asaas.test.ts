import { PROBLEMA_COBRANCA_INDISPONIVEL } from '@es/contrato/plano';
import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ErroAsaas } from '../../src/integracoes/asaas.ts';
import { ErroEnvioEmail } from '../../src/integracoes/resend.ts';
import { comoAdmin, emailSimulado, sha256 } from '../apoio.ts';
import { contaComSessao, eventosDe, postar, semearToken, tokensDe } from './conta-apoio.ts';
import { type Estado, asaasSimulado, linhaAssinatura, semearAssinatura } from './plano-apoio.ts';

// T181 / CONTA-03, CONTA-04: ao confirmar a exclusão, além de bloquear (T150):
// - cancela a assinatura no Asaas quando há uma lá ainda não cancelada (404 = já cancelada);
//   ativa vira cancelada no app; Asaas fora responde 503 cobranca_indisponivel sem bloquear nada
//   (o link continua valendo);
// - envia, depois do COMMIT, o e-mail com a data da purga e o link de desistência, de uso único,
//   válido por 30 dias (vence junto com a purga). Falha do envio vai ao Sentry sem mudar a
//   resposta; sem Resend configurado o envio fica desligado.

const LENTO = { timeout: 30_000 };
const URL_PUBLICA = 'http://localhost:8787';
const DIA = 24 * 60 * 60_000;

function montar(opcoes: { semEmail?: boolean } = {}) {
  const correio = emailSimulado();
  const asaas = asaasSimulado();
  const capturarErro = vi.fn();
  const pendentes: Promise<unknown>[] = [];
  const app = criarApp({
    capturarErro,
    asaas: () => asaas.cliente,
    ...(opcoes.semEmail ? {} : { email: () => correio.cliente }),
    emSegundoPlano: (tarefa) => void pendentes.push(tarefa),
  });
  const confirmar = async (token: string) => {
    const resposta = await postar(app, '/api/conta/excluir/confirmar', { token });
    await Promise.all(pendentes);
    return resposta;
  };
  return { confirmar, correio, asaas, capturarErro };
}

async function cenario(status: Estado | null, comAsaas = true) {
  const conta = await contaComSessao();
  const ids =
    status === null
      ? { cliente: null, assinatura: null }
      : await semearAssinatura(conta.usuarioId, status, {
          comAsaas,
          periodoFim: new Date(Date.now() + 10 * DIA).toISOString(),
        });
  const token = await semearToken(conta.usuarioId, 'exclusao', 30);
  return { conta, ids, token };
}

const bloqueio = async (usuarioId: string) =>
  (
    await comoAdmin<{ b: Date | null }>(
      'select bloqueado_exclusao_em as b from usuario where id = $1',
      [usuarioId],
    )
  )[0]!.b;

const tokenDoLink = (texto: string): string => {
  const achado = new RegExp(`${URL_PUBLICA}/desistir-exclusao\\?token=([A-Za-z0-9_-]+)`).exec(
    texto,
  );
  if (!achado) throw new Error('link /desistir-exclusao não encontrado no e-mail');
  return achado[1]!;
};

describe('assinatura no Asaas cancelada (CONTA-03)', LENTO, () => {
  it('ativa: cancela no Asaas e fica cancelada no app, auditada', async () => {
    const { confirmar, asaas } = montar();
    const { conta, ids, token } = await cenario('ativa');
    expect((await confirmar(token)).status).toBe(200);
    expect(asaas.chamadas).toEqual([{ operacao: 'cancelarAssinatura', dados: ids.assinatura }]);
    expect(await linhaAssinatura(conta.usuarioId)).toMatchObject({ status: 'cancelada' });
    expect(await eventosDe(conta.usuarioId, 'assinatura.')).toMatchObject([
      { acao: 'assinatura.cancelada', campos_alterados: ['status'] },
    ]);
  });

  it.each(['trial', 'atrasada', 'free'] as const)(
    '%s com assinatura no Asaas: cancela lá e o estado no app fica',
    async (status) => {
      const { confirmar, asaas } = montar();
      const { conta, ids, token } = await cenario(status);
      expect((await confirmar(token)).status).toBe(200);
      expect(asaas.chamadas).toEqual([{ operacao: 'cancelarAssinatura', dados: ids.assinatura }]);
      expect(await linhaAssinatura(conta.usuarioId)).toMatchObject({ status });
    },
  );

  it('cancelada: já foi cancelada no Asaas, não chama de novo', async () => {
    const { confirmar, asaas } = montar();
    const { token } = await cenario('cancelada');
    expect((await confirmar(token)).status).toBe(200);
    expect(asaas.chamadas).toEqual([]);
  });

  it('sem assinatura no Asaas (trial do cadastro) ou sem assinatura: não chama o Asaas', async () => {
    const { confirmar, asaas } = montar();
    const trial = await cenario('trial', false);
    const nenhuma = await cenario(null);
    expect((await confirmar(trial.token)).status).toBe(200);
    expect((await confirmar(nenhuma.token)).status).toBe(200);
    expect(asaas.chamadas).toEqual([]);
  });

  it('404 do Asaas conta como já cancelada', async () => {
    const { confirmar, asaas } = montar();
    asaas.falharEm('cancelarAssinatura', new ErroAsaas('falha', 404));
    const { conta, token } = await cenario('ativa');
    expect((await confirmar(token)).status).toBe(200);
    expect(await bloqueio(conta.usuarioId)).not.toBeNull();
    expect(await linhaAssinatura(conta.usuarioId)).toMatchObject({ status: 'cancelada' });
  });

  it('Asaas fora: 503 sem bloquear, sem encerrar sessão e com o link ainda valendo', async () => {
    const { confirmar, asaas, capturarErro, correio } = montar();
    const erro = new ErroAsaas('falha', 500);
    asaas.falharEm('cancelarAssinatura', erro);
    const { conta, token } = await cenario('ativa');

    const resposta = await confirmar(token);

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual(PROBLEMA_COBRANCA_INDISPONIVEL);
    expect(capturarErro).toHaveBeenCalledWith(erro);
    expect(await bloqueio(conta.usuarioId)).toBeNull();
    expect(await linhaAssinatura(conta.usuarioId)).toMatchObject({ status: 'ativa' });
    expect(await eventosDe(conta.usuarioId)).toEqual([]);
    expect(correio.enviadas).toEqual([]);
    expect((await tokensDe(conta.usuarioId, 'exclusao'))[0]!.usado_em).toBeNull();

    const depois = montar();
    expect((await depois.confirmar(token)).status).toBe(200);
  });
});

describe('e-mail com a data da purga e o link de desistência (CONTA-03, CONTA-04)', LENTO, () => {
  it('envia ao e-mail da conta a data da purga e o link /desistir-exclusao', async () => {
    const { confirmar, correio } = montar();
    const { conta, token } = await cenario(null);
    const resposta = await confirmar(token);
    const { purga_em: purgaEm } = (await resposta.json()) as { purga_em: string };

    expect(correio.enviadas).toHaveLength(1);
    const [mensagem] = correio.enviadas;
    expect(mensagem!.para).toBe(conta.email);
    const dataBr = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(purgaEm));
    expect(mensagem!.texto).toContain(dataBr);
    expect(mensagem!.texto).toContain(`${URL_PUBLICA}/desistir-exclusao?token=`);
  });

  it('link de desistência: 256 bits, só o SHA-256, uso único, vence com a purga (30 dias)', async () => {
    const { confirmar, correio } = montar();
    const { conta, token } = await cenario(null);
    await confirmar(token);
    const desistencia = tokenDoLink(correio.enviadas[0]!.texto);
    expect(Buffer.from(desistencia, 'base64url')).toHaveLength(32);

    const linhas = await tokensDe(conta.usuarioId, 'desistencia');
    expect(linhas).toHaveLength(1);
    const [linha] = linhas;
    expect(linha!.token_hash.equals(await sha256(desistencia))).toBe(true);
    expect(linha!.usado_em).toBeNull();
    expect(linha!.invalidado_em).toBeNull();
    const bloqueadoEm = (await bloqueio(conta.usuarioId))!;
    expect(linha!.expira_em.getTime() - bloqueadoEm.getTime()).toBe(30 * DIA);
  });

  it('falha do envio vai ao Sentry e a confirmação continua valendo', async () => {
    const { confirmar, correio, capturarErro } = montar();
    const erro = new ErroEnvioEmail('falha', 500);
    correio.falhar(erro);
    const { conta, token } = await cenario(null);
    expect((await confirmar(token)).status).toBe(200);
    expect(capturarErro).toHaveBeenCalledWith(erro);
    expect(await bloqueio(conta.usuarioId)).not.toBeNull();
    expect(await tokensDe(conta.usuarioId, 'desistencia')).toHaveLength(1);
  });

  it('sem Resend configurado o envio fica desligado, sem erro no Sentry', async () => {
    const { confirmar, capturarErro } = montar({ semEmail: true });
    const { conta, token } = await cenario(null);
    expect((await confirmar(token)).status).toBe(200);
    expect(capturarErro).not.toHaveBeenCalled();
    expect(await tokensDe(conta.usuarioId, 'desistencia')).toHaveLength(1);
  });

  it('link que não serve não envia e-mail nem chama o Asaas', async () => {
    const { confirmar, correio, asaas } = montar();
    expect((await confirmar('nao-existe')).status).toBe(400);
    expect(correio.enviadas).toEqual([]);
    expect(asaas.chamadas).toEqual([]);
  });
});
