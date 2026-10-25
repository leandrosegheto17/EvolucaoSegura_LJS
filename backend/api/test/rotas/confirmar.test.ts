import { VERSAO_PRIVACIDADE, VERSAO_TERMOS } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, emailSimulado, emailUnico, novoIp, sha256 } from '../apoio.ts';

// T45 / CAD-04, CAD-05, CAD-07, AUD-04: POST /api/cadastro/confirmar com o token do link.
// - Token válido: ativa a conta, cria a assinatura em trial com periodo_fim = confirmação + 14
//   dias, registra o aceite dos termos (data, hora e versões dos termos e da privacidade) e audita
//   conta.cadastrada, tudo na mesma transação. Não abre sessão.
// - Token inválido, expirado, já usado ou invalidado: 400 link_invalido sem alterar nada.

const LINK_INVALIDO = {
  tipo: 'about:blank',
  titulo: 'Link inválido',
  status: 400,
  codigo: 'link_invalido',
};
const DIA = 24 * 60 * 60_000;

function montar() {
  const correio = emailSimulado();
  const capturarErro = vi.fn();
  const app = criarApp({ email: () => correio.cliente, capturarErro });
  const pedir = (caminho: string, corpo: unknown, ip = novoIp()) =>
    app.request(
      caminho,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ip,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0',
        },
        body: JSON.stringify(corpo),
      },
      env,
    );
  const confirmar = async (token: unknown, ip?: string) => {
    const resposta = await pedir('/api/cadastro/confirmar', { token }, ip);
    return { status: resposta.status, corpo: (await resposta.json()) as unknown };
  };
  // Cadastra pela rota real e devolve o token do link do último e-mail.
  const cadastrar = async (email: string, nome = 'Ana Souza') => {
    await pedir('/api/cadastro', {
      nome,
      email,
      senha: 'cavalo-bateria-grampo-7',
      aceite_termos: true,
    });
    const texto = correio.enviadas.at(-1)!.texto;
    return /\/confirmar\?token=([A-Za-z0-9_-]+)/.exec(texto)![1]!;
  };
  return { confirmar, cadastrar, capturarErro };
}

const usuarioPorEmail = async (email: string) =>
  (
    await comoAdmin<{ id: string; confirmado_em: Date | null }>(
      'select id, confirmado_em from usuario where email = $1',
      [email],
    )
  )[0]!;

async function estadoDaConta(usuarioId: string) {
  const [usuario] = await comoAdmin<{ confirmado_em: Date | null }>(
    'select confirmado_em from usuario where id = $1',
    [usuarioId],
  );
  return {
    confirmadoEm: usuario!.confirmado_em,
    assinaturas: await comoAdmin('select * from assinatura where usuario_id = $1', [usuarioId]),
    aceites: await comoAdmin('select * from aceite_termos where usuario_id = $1', [usuarioId]),
    auditoria: await comoAdmin('select * from audit_log where usuario_id = $1', [usuarioId]),
    tokensUsados: (
      await comoAdmin<{ total: string }>(
        'select count(*)::text as total from token_email where usuario_id = $1 and usado_em is not null',
        [usuarioId],
      )
    )[0]!.total,
  };
}

const CONTA_INTACTA = {
  confirmadoEm: null,
  assinaturas: [],
  aceites: [],
  auditoria: [],
  tokensUsados: '0',
};

describe('link válido (CAD-04, CAD-07, AUD-04)', () => {
  it('responde 200 e ativa a conta, sem abrir sessão', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('confirma');
    const token = await cadastrar(email);

    const resposta = await confirmar(token);

    expect(resposta).toEqual({ status: 200, corpo: { status: 'confirmada' } });
    const { id, confirmado_em } = await usuarioPorEmail(email);
    expect(confirmado_em).toBeInstanceOf(Date);
    const [sessoes] = await comoAdmin<{ total: string }>(
      'select count(*)::text as total from sessao where usuario_id = $1',
      [id],
    );
    expect(sessoes!.total).toBe('0');
  });

  it('cria a assinatura trial com periodo_fim igual à confirmação mais 14 dias', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('trial');
    await confirmar(await cadastrar(email));

    const { id, confirmado_em } = await usuarioPorEmail(email);
    const [assinatura] = await comoAdmin<{ plano: string; status: string; periodo_fim: Date }>(
      'select plano, status, periodo_fim from assinatura where usuario_id = $1',
      [id],
    );
    expect(assinatura).toMatchObject({ plano: 'pro', status: 'trial' });
    expect(assinatura!.periodo_fim.getTime() - confirmado_em!.getTime()).toBe(14 * DIA);
  });

  it('registra o aceite com data, hora e as versões dos termos e da privacidade', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('aceite');
    await confirmar(await cadastrar(email));

    const { id, confirmado_em } = await usuarioPorEmail(email);
    const aceites = await comoAdmin<{
      versao_termos: string;
      versao_privacidade: string;
      aceito_em: Date;
    }>(
      'select versao_termos, versao_privacidade, aceito_em from aceite_termos where usuario_id = $1',
      [id],
    );
    expect(aceites).toEqual([
      {
        versao_termos: VERSAO_TERMOS,
        versao_privacidade: VERSAO_PRIVACIDADE,
        aceito_em: confirmado_em,
      },
    ]);
  });

  it('audita conta.cadastrada com o próprio profissional como ator, IP truncado e sem dado pessoal', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('auditoria');
    await confirmar(await cadastrar(email), '198.51.100.77');

    const { id } = await usuarioPorEmail(email);
    const eventos = await comoAdmin('select * from audit_log where usuario_id = $1', [id]);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      usuario_id: id,
      ator: id,
      acao: 'conta.cadastrada',
      alvo_tipo: 'conta',
      alvo_id: id,
      campos_alterados: [],
      origem_ip: '198.51.100.0/24',
      origem_ua: 'Mozilla/5',
    });
    expect(JSON.stringify(eventos)).not.toContain(email);
  });

  it('marca o token como usado', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('usado');
    const token = await cadastrar(email);
    await confirmar(token);

    const [linha] = await comoAdmin<{ usado_em: Date | null }>(
      'select usado_em from token_email where token_hash = $1',
      [await sha256(token)],
    );
    expect(linha!.usado_em).toBeInstanceOf(Date);
  });
});

describe('link inválido, expirado ou usado (CAD-05)', () => {
  it('token já usado: 400 link_invalido sem alterar a conta', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('reuso');
    const token = await cadastrar(email);
    await confirmar(token);
    const { id } = await usuarioPorEmail(email);
    const antes = await estadoDaConta(id);

    expect(await confirmar(token)).toEqual({ status: 400, corpo: LINK_INVALIDO });
    expect(await estadoDaConta(id)).toEqual(antes);
  });

  it('token expirado: 400 link_invalido sem alterar a conta', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('expirado');
    const token = await cadastrar(email);
    await comoAdmin(
      "update token_email set expira_em = now() - interval '1 second' where token_hash = $1",
      [await sha256(token)],
    );

    expect(await confirmar(token)).toEqual({ status: 400, corpo: LINK_INVALIDO });
    expect(await estadoDaConta((await usuarioPorEmail(email)).id)).toEqual(CONTA_INTACTA);
  });

  it('token invalidado por um novo cadastro: 400; o token novo continua valendo', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('invalidado');
    const antigo = await cadastrar(email);
    const novo = await cadastrar(email, 'Ana Nova');
    const { id } = await usuarioPorEmail(email);

    expect(await confirmar(antigo)).toEqual({ status: 400, corpo: LINK_INVALIDO });
    expect(await estadoDaConta(id)).toEqual(CONTA_INTACTA);
    expect((await confirmar(novo)).status).toBe(200);
  });

  it('token de outro tipo (recuperação) não confirma a conta', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('outro-tipo');
    await cadastrar(email);
    const { id } = await usuarioPorEmail(email);
    const tokenRecuperacao = `recuperacao-${crypto.randomUUID()}`;
    await comoAdmin(
      `insert into token_email (usuario_id, tipo, token_hash, expira_em)
       values ($1, 'recuperacao', $2, now() + interval '30 minutes')`,
      [id, await sha256(tokenRecuperacao)],
    );

    expect(await confirmar(tokenRecuperacao)).toEqual({ status: 400, corpo: LINK_INVALIDO });
    expect(await estadoDaConta(id)).toEqual(CONTA_INTACTA);
  });

  it('conta já confirmada com outro token de confirmação aberto: 400 sem alterar nada', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('ja-confirmada');
    await confirmar(await cadastrar(email));
    const { id } = await usuarioPorEmail(email);
    const sobra = `sobrando-${crypto.randomUUID()}`;
    await comoAdmin(
      `insert into token_email (usuario_id, tipo, token_hash, expira_em)
       values ($1, 'confirmacao', $2, now() + interval '30 minutes')`,
      [id, await sha256(sobra)],
    );
    const antes = await estadoDaConta(id);

    expect(await confirmar(sobra)).toEqual({ status: 400, corpo: LINK_INVALIDO });
    expect(await estadoDaConta(id)).toEqual(antes);
  });

  it.each([
    ['desconhecido', 'A'.repeat(43)],
    ['malformado', 'não é token!'],
    ['vazio', ''],
  ])('token %s: 400 link_invalido', async (_rotulo, token) => {
    const { confirmar } = montar();
    expect(await confirmar(token)).toEqual({ status: 400, corpo: LINK_INVALIDO });
  });

  it('dois cliques ao mesmo tempo: só um confirma (uso único)', async () => {
    const { confirmar, cadastrar } = montar();
    const email = emailUnico('duplo');
    const token = await cadastrar(email);

    const respostas = await Promise.all([confirmar(token), confirmar(token)]);

    expect(respostas.map((r) => r.status).sort()).toEqual([200, 400]);
    const estado = await estadoDaConta((await usuarioPorEmail(email)).id);
    expect([estado.assinaturas.length, estado.aceites.length, estado.auditoria.length]).toEqual([
      1, 1, 1,
    ]);
  });
});

describe('auditoria na mesma transação (AUD-01, AUD-04)', () => {
  it('falha ao gravar a auditoria desfaz a confirmação inteira', async () => {
    const { confirmar, cadastrar, capturarErro } = montar();
    const email = emailUnico('falha-auditoria');
    const token = await cadastrar(email);
    const { id } = await usuarioPorEmail(email);
    const sufixo = id.replaceAll('-', '');
    // Gatilho temporário que recusa só o evento deste profissional.
    await comoAdmin(`
      create function public.recusar_auditoria_${sufixo}() returns trigger language plpgsql as $$
      begin
        if new.usuario_id = '${id}' then raise exception 'auditoria recusada no teste'; end if;
        return new;
      end $$;
      create trigger recusar_${sufixo} before insert on public.audit_log
        for each row execute function public.recusar_auditoria_${sufixo}();`);
    try {
      const resposta = await confirmar(token);
      expect(resposta.status).toBe(500);
      expect(capturarErro).toHaveBeenCalledTimes(1);
      expect(await estadoDaConta(id)).toEqual(CONTA_INTACTA);
    } finally {
      await comoAdmin(`
        drop trigger recusar_${sufixo} on public.audit_log;
        drop function public.recusar_auditoria_${sufixo}();`);
    }
    expect((await confirmar(token)).status).toBe(200);
  });
});

describe('contrato', () => {
  it('sem token ou com chave desconhecida: 422 validacao', async () => {
    const { confirmar } = montar();
    const app = criarApp({ email: () => emailSimulado().cliente });
    const semToken = await app.request(
      '/api/cadastro/confirmar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': novoIp() },
        body: '{}',
      },
      env,
    );
    expect(semToken.status).toBe(422);
    expect(await semToken.json()).toMatchObject({ codigo: 'validacao', campos: ['token'] });
    const extra = await app.request(
      '/api/cadastro/confirmar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': novoIp() },
        body: JSON.stringify({ token: 'x', email: 'a@b.com' }),
      },
      env,
    );
    expect(extra.status).toBe(422);
    expect((await confirmar('x')).status).toBe(400);
  });
});
