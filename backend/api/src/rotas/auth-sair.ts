import { Hono } from 'hono';
import { sql } from 'kysely';
import { limparCookieSessao } from '../cookie-sessao.ts';
import { comTransacao } from '../db.ts';
import { csrf } from '../middleware/csrf.ts';
import { type VariaveisSessao, sessao } from '../middleware/sessao.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';

// AUTH-16, AUD-04: POST /api/auth/sair. Rota autenticada (sessão e CSRF). Na transação do
// profissional, encerra a sessão com UPDATE de data (a app não apaga) e audita auth.logout; depois
// limpa o cookie com Max-Age=0 e responde 204.

export const rotasSair = new Hono<{ Bindings: Cloudflare.Env; Variables: VariaveisSessao }>().post(
  '/auth/sair',
  sessao,
  csrf,
  async (c) => {
    const { usuarioId, sessaoId } = c.var;
    await comTransacao(c.env, usuarioId, async (trx) => {
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
    });
    limparCookieSessao(c);
    return c.body(null, 204);
  },
);
