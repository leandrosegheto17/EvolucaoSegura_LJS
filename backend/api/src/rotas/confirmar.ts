import {
  RESPOSTA_CONFIRMACAO,
  VERSAO_PRIVACIDADE,
  VERSAO_TERMOS,
  esquemaConfirmarEmail,
} from '@es/contrato/identidade';
import { Hono } from 'hono';
import { comTransacao, definirUsuarioDaTransacao } from '../db.ts';
import { lerCorpo, responderProblema } from '../http.ts';
import { iniciarTrial } from '../repositorios/assinatura.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { confirmarConta, consumirToken, registrarAceite } from '../repositorios/identidade.ts';
import { hashDoToken } from '../tokens.ts';

// CAD-04, CAD-05, CAD-07, AUD-04: POST /api/cadastro/confirmar com o token do link. Numa só
// transação: consome o token, ativa a conta, inicia o trial de 14 dias, registra o aceite dos
// termos (data e hora do banco e as versões em vigor) e audita conta.cadastrada. Qualquer falha
// desfaz tudo. Token inválido, expirado, usado ou invalidado (ou conta já confirmada) responde
// 400 link_invalido sem alterar nada. Não abre sessão: o profissional entra com senha e 2FA.

export const DIAS_TRIAL = 14;

// Sinal interno para desfazer a transação quando o link não serve.
class LinkInvalido extends Error {}

export const rotasConfirmar = new Hono<{ Bindings: Cloudflare.Env }>().post(
  '/cadastro/confirmar',
  async (c) => {
    const leitura = await lerCorpo(c, esquemaConfirmarEmail);
    if (!leitura.ok) return leitura.resposta;
    const hash = await hashDoToken(leitura.dados.token);

    try {
      await comTransacao(c.env, null, async (trx) => {
        const usuarioId = await consumirToken(trx, hash, 'confirmacao');
        if (usuarioId === null) throw new LinkInvalido();
        if (!(await confirmarConta(trx, usuarioId))) throw new LinkInvalido();
        // A partir daqui o RLS vale para este profissional (assinatura e audit_log).
        await definirUsuarioDaTransacao(trx, usuarioId);
        await iniciarTrial(trx, usuarioId, DIAS_TRIAL);
        await registrarAceite(trx, {
          usuarioId,
          versaoTermos: VERSAO_TERMOS,
          versaoPrivacidade: VERSAO_PRIVACIDADE,
        });
        await registrarAuditoria(trx, {
          usuarioId,
          ator: usuarioId,
          acao: 'conta.cadastrada',
          alvoTipo: 'conta',
          alvoId: usuarioId,
          ip: c.req.header('CF-Connecting-IP') ?? null,
          userAgent: c.req.header('User-Agent') ?? null,
        });
      });
    } catch (erro) {
      if (erro instanceof LinkInvalido)
        return responderProblema(c, 'link_invalido', 'Link inválido');
      throw erro;
    }
    return c.json(RESPOSTA_CONFIRMACAO, 200);
  },
);
