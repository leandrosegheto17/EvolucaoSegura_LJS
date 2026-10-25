import { Hono } from 'hono';
import { sql } from 'kysely';
import { limparCookieSessao } from '../cookie-sessao.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';

// AUTH-16, AUD-04: POST /api/auth/sair. Rota autenticada (sessão, CSRF e transação do
// profissional). Encerra a sessão com UPDATE de data (a app não apaga) e audita auth.logout na
// mesma transação; depois limpa o cookie com Max-Age=0 e responde 204.

export const rotasSair = new Hono<AmbienteAutenticado>().post(
  '/auth/sair',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId, sessaoId } = c.var;
    await trx
      .updateTable('sessao')
      .set({ encerrada_em: sql<Date>`now()` })
      .where('id', '=', sessaoId)
      .where('encerrada_em', 'is', null)
      .execute();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'auth.logout',
      alvoTipo: 'auth',
      alvoId: sessaoId,
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    limparCookieSessao(c);
    return c.body(null, 204);
  },
);
