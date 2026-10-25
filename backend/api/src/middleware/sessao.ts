import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { sessaoExpirada } from '@es/dominio/identidade/regras-acesso';
import type { MiddlewareHandler } from 'hono';
import { sql } from 'kysely';
import { lerCookieSessao } from '../cookie-sessao.ts';
import { comTransacao } from '../db.ts';
import { hashDoToken } from '../tokens.ts';

// AUTH-09: resolve o cookie __Host-sid pelo SHA-256 na tabela sessao. A sessão encerra 15 minutos
// depois do último uso ou 12 horas depois do login, o que vier primeiro, comparando com o now()
// do banco (regra em regras-acesso.ts). Vencida, ela é marcada encerrada (UPDATE; a app não
// apaga). Válida, renova o último uso e passa adiante o usuário, a sessão e o id do cookie (o
// CSRF deriva dele). Cookie ausente, desconhecido, vencido ou de sessão encerrada: 401, sem
// chegar ao handler.

export interface VariaveisSessao {
  usuarioId: string;
  sessaoId: string;
  sid: string;
}

type Resolucao = { ok: false } | { ok: true; usuarioId: string; sessaoId: string };

export const sessao: MiddlewareHandler<{
  Bindings: Cloudflare.Env;
  Variables: VariaveisSessao;
}> = async (c, next) => {
  const sid = lerCookieSessao(c);
  if (!sid) return naoAutorizado();
  const hash = await hashDoToken(sid);

  const resolucao = await comTransacao(c.env, null, async (trx): Promise<Resolucao> => {
    const linha = await trx
      .selectFrom('sessao')
      .select(['id', 'usuario_id', 'criada_em', 'ultimo_uso_em', sql<Date>`now()`.as('agora')])
      .where('token_hash', '=', hash)
      .where('encerrada_em', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!linha) return { ok: false };
    const vencida = sessaoExpirada(
      { criadaEm: linha.criada_em, ultimoUsoEm: linha.ultimo_uso_em },
      linha.agora,
    );
    await trx
      .updateTable('sessao')
      .set(vencida ? { encerrada_em: sql<Date>`now()` } : { ultimo_uso_em: sql<Date>`now()` })
      .where('id', '=', linha.id)
      .execute();
    if (vencida) return { ok: false };
    return { ok: true, usuarioId: linha.usuario_id, sessaoId: linha.id };
  });
  if (!resolucao.ok) return naoAutorizado();

  c.set('usuarioId', resolucao.usuarioId);
  c.set('sessaoId', resolucao.sessaoId);
  c.set('sid', sid);
  await next();

  function naoAutorizado(): Response {
    return c.json(RESPOSTA_LOGIN_RECUSADO, 401, { 'Content-Type': 'application/problem+json' });
  }
};
