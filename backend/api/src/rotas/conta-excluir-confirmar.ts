import {
  DIAS_ATE_PURGA,
  type RespostaConfirmarExclusao,
  esquemaTokenExclusao,
} from '@es/contrato/conta';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { type Trx, comTransacao, definirUsuarioDaTransacao } from '../db.ts';
import { lerCorpo, responderProblema } from '../http.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { consumirToken, encerrarSessoesDoUsuario } from '../repositorios/identidade.ts';
import { hashDoToken } from '../tokens.ts';

// CONTA-03 (T150): POST /api/conta/excluir/confirmar com o token do link do e-mail. Rota pública
// (o link pode ser aberto noutro aparelho, sem sessão), como a confirmação do cadastro. Numa só
// transação:
// 1. consome o token de exclusão (uso único, dentro dos 30 minutos, não invalidado); se não serve,
//    400 link_invalido;
// 2. bloqueia a conta (bloqueado_exclusao_em = now()); conta já bloqueada também é link_invalido,
//    e a transação é desfeita (o token não é gasto);
// 3. encerra todas as sessões abertas do profissional (UPDATE de data) e audita
//    conta.exclusao_confirmada só com o nome do campo.
// Responde 200 com a data da purga: DIAS_ATE_PURGA dias depois do bloqueio. Daí em diante o login
// e o 2FA recusam a conta com o 401 de sempre (contaPodeEntrar, AUTH-02).

// Sinal interno para desfazer a transação quando o link não serve.
class LinkInvalido extends Error {}

async function bloquear(trx: Trx, usuarioId: string): Promise<Date | null> {
  const linha = await trx
    .updateTable('usuario')
    .set({ bloqueado_exclusao_em: sql<Date>`now()` })
    .where('id', '=', usuarioId)
    .where('bloqueado_exclusao_em', 'is', null)
    .returning('bloqueado_exclusao_em')
    .executeTakeFirst();
  return linha?.bloqueado_exclusao_em ?? null;
}

export const rotasContaExcluirConfirmar = () =>
  new Hono<{ Bindings: Cloudflare.Env }>().post('/conta/excluir/confirmar', async (c) => {
    const leitura = await lerCorpo(c, esquemaTokenExclusao);
    if (!leitura.ok) return leitura.resposta;
    const hash = await hashDoToken(leitura.dados.token);

    let bloqueadoEm: Date;
    try {
      bloqueadoEm = await comTransacao(c.env, null, async (trx) => {
        const usuarioId = await consumirToken(trx, hash, 'exclusao');
        if (usuarioId === null) throw new LinkInvalido();
        const bloqueio = await bloquear(trx, usuarioId);
        if (bloqueio === null) throw new LinkInvalido();
        await encerrarSessoesDoUsuario(trx, usuarioId);
        // A partir daqui o RLS vale para este profissional (audit_log).
        await definirUsuarioDaTransacao(trx, usuarioId);
        await registrarAuditoria(trx, {
          usuarioId,
          ator: usuarioId,
          acao: 'conta.exclusao_confirmada',
          alvoTipo: 'conta',
          alvoId: usuarioId,
          camposAlterados: ['bloqueado_exclusao_em'],
          ip: c.req.header('CF-Connecting-IP') ?? null,
          userAgent: c.req.header('User-Agent') ?? null,
        });
        return bloqueio;
      });
    } catch (erro) {
      if (erro instanceof LinkInvalido)
        return responderProblema(c, 'link_invalido', 'Link inválido');
      throw erro;
    }

    const resposta: RespostaConfirmarExclusao = {
      status: 'bloqueada',
      purga_em: new Date(bloqueadoEm.getTime() + DIAS_ATE_PURGA * 24 * 60 * 60_000).toISOString(),
    };
    return c.json(resposta, 200);
  });
