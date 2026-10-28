import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ErroEnvioEmail } from '../../src/integracoes/resend.ts';
import { comoAdmin, emailSimulado, sha256 } from '../apoio.ts';
import {
  type ContaComSessao,
  contaComSessao,
  eventosDe,
  postar,
  semearExportacao,
  tokensDe,
} from './conta-apoio.ts';

// T180 / CONTA-02, AUD-04: com todos os requisitos, POST /api/conta/excluir envia ao e-mail da
// conta o link de confirmação, com token de 256 bits guardado só como SHA-256, válido por 30
// minutos e de uso único (o consumo é da confirmação, T150; um pedido novo invalida o anterior),
// e audita conta.exclusao_pedida sem dado pessoal. O e-mail sai depois do COMMIT; a falha vai ao
// Sentry sem mudar a resposta; sem Resend configurado o envio fica desligado, sem erro.

const LENTO = { timeout: 30_000 };
const URL_PUBLICA = 'http://localhost:8787';

function montar(opcoes: { semEmail?: boolean } = {}) {
  const correio = emailSimulado();
  const capturarErro = vi.fn();
  const pendentes: Promise<unknown>[] = [];
  const app = criarApp({
    capturarErro,
    // Sem a opção, vale o e-mail padrão do app; o ambiente de teste não tem RESEND_API_KEY nem
    // MAIL_FROM (vitest.config.ts).
    ...(opcoes.semEmail ? {} : { email: () => correio.cliente }),
    emSegundoPlano: (tarefa) => void pendentes.push(tarefa),
  });
  const pedir = async (conta: ContaComSessao) => {
    const resposta = await postar(
      app,
      '/api/conta/excluir',
      { senha: conta.senha, declaracao_guarda: true },
      conta,
    );
    await Promise.all(pendentes);
    return resposta;
  };
  return { pedir, correio, capturarErro };
}

async function contaPronta(): Promise<ContaComSessao> {
  const conta = await contaComSessao();
  await semearExportacao(conta.usuarioId);
  return conta;
}

const tokenDoLink = (texto: string): string => {
  const achado = new RegExp(`${URL_PUBLICA}/confirmar-exclusao\\?token=([A-Za-z0-9_-]+)`).exec(
    texto,
  );
  if (!achado) throw new Error('link /confirmar-exclusao não encontrado no e-mail');
  return achado[1]!;
};

describe('e-mail de confirmação (CONTA-02)', LENTO, () => {
  it('envia o link de confirmação ao e-mail da conta', async () => {
    const { pedir, correio } = montar();
    const conta = await contaPronta();
    expect((await pedir(conta)).status).toBe(202);
    expect(correio.enviadas).toHaveLength(1);
    const [mensagem] = correio.enviadas;
    expect(mensagem!.para).toBe(conta.email);
    expect(mensagem!.texto).toContain(`${URL_PUBLICA}/confirmar-exclusao?token=`);
    expect(mensagem!.texto).toContain('30 minutos');
    expect(mensagem!.texto).not.toContain(conta.senha);
  });

  it('token de 256 bits, só o SHA-256 no banco, 30 minutos, ainda não usado', async () => {
    const { pedir, correio } = montar();
    const conta = await contaPronta();
    await pedir(conta);
    const token = tokenDoLink(correio.enviadas[0]!.texto);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);

    const linhas = await tokensDe(conta.usuarioId, 'exclusao');
    expect(linhas).toHaveLength(1);
    const [linha] = linhas;
    expect(linha!.token_hash.equals(await sha256(token))).toBe(true);
    expect(linha!.expira_em.getTime() - linha!.criado_em.getTime()).toBe(30 * 60_000);
    expect(linha!.usado_em).toBeNull();
    expect(linha!.invalidado_em).toBeNull();
    const [emClaro] = await comoAdmin<{ n: number }>(
      `select count(*)::int as n from token_email where usuario_id = $1
       and position(convert_to($2, 'UTF8') in token_hash) > 0`,
      [conta.usuarioId, token],
    );
    expect(emClaro).toEqual({ n: 0 });
  });

  it('um pedido novo invalida o link anterior ainda aberto', async () => {
    const { pedir } = montar();
    const conta = await contaPronta();
    await pedir(conta);
    await pedir(conta);
    const linhas = await tokensDe(conta.usuarioId, 'exclusao');
    expect(linhas).toHaveLength(2);
    expect(linhas[0]!.invalidado_em).not.toBeNull();
    expect(linhas[1]!.invalidado_em).toBeNull();
  });

  it('cada pedido gera um token diferente', async () => {
    const { pedir, correio } = montar();
    const conta = await contaPronta();
    await pedir(conta);
    await pedir(conta);
    const [a, b] = correio.enviadas.map((m) => tokenDoLink(m.texto));
    expect(a).not.toBe(b);
  });

  it('não toca nos tokens de outro profissional', async () => {
    const { pedir } = montar();
    const outro = await contaPronta();
    await pedir(outro);
    const conta = await contaPronta();
    await pedir(conta);
    expect((await tokensDe(outro.usuarioId, 'exclusao'))[0]!.invalidado_em).toBeNull();
  });

  it('o pedido não bloqueia a conta nem encerra a sessão', async () => {
    const { pedir } = montar();
    const conta = await contaPronta();
    await pedir(conta);
    const [linha] = await comoAdmin<{ bloqueado_exclusao_em: Date | null; abertas: number }>(
      `select u.bloqueado_exclusao_em,
              (select count(*)::int from sessao s
               where s.usuario_id = u.id and s.encerrada_em is null) as abertas
       from usuario u where u.id = $1`,
      [conta.usuarioId],
    );
    expect(linha).toEqual({ bloqueado_exclusao_em: null, abertas: 1 });
  });
});

describe('auditoria conta.exclusao_pedida (AUD-04)', LENTO, () => {
  it('audita o pedido com alvo conta, sem dado pessoal', async () => {
    const { pedir } = montar();
    const conta = await contaPronta();
    await pedir(conta);
    const eventos = await eventosDe(conta.usuarioId);
    expect(eventos).toEqual([
      {
        ator: conta.usuarioId,
        acao: 'conta.exclusao_pedida',
        alvo_tipo: 'conta',
        alvo_id: conta.usuarioId,
        campos_alterados: [],
        origem_ip: expect.any(String),
        origem_ua: 'Mozilla/5',
      },
    ]);
    const texto = JSON.stringify(eventos);
    expect(texto).not.toContain(conta.email);
    expect(texto).not.toContain('Ana Souza');
    expect(texto).not.toContain(conta.senha);
  });

  it('o pedido recusado não audita', async () => {
    const { correio } = montar();
    const conta = await contaComSessao();
    const app = criarApp({ capturarErro: () => {}, email: () => correio.cliente });
    await postar(app, '/api/conta/excluir', { senha: conta.senha, declaracao_guarda: true }, conta);
    expect(await eventosDe(conta.usuarioId)).toEqual([]);
  });
});

describe('falha e desligamento do envio', LENTO, () => {
  it('falha do envio vai ao Sentry, responde 202 e o link continua gravado', async () => {
    const { pedir, correio, capturarErro } = montar();
    const conta = await contaPronta();
    const erro = new ErroEnvioEmail('falha', 500);
    correio.falhar(erro);
    expect((await pedir(conta)).status).toBe(202);
    expect(capturarErro).toHaveBeenCalledWith(erro);
    expect(await tokensDe(conta.usuarioId, 'exclusao')).toHaveLength(1);
  });

  it('sem Resend configurado o envio fica desligado, sem erro no Sentry', async () => {
    const { pedir, capturarErro } = montar({ semEmail: true });
    const conta = await contaPronta();
    expect((await pedir(conta)).status).toBe(202);
    expect(capturarErro).not.toHaveBeenCalled();
    expect(await tokensDe(conta.usuarioId, 'exclusao')).toHaveLength(1);
  });
});
