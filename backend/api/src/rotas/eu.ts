import { Hono } from 'hono';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { csrfDaSessao } from '../tokens.ts';

// GET /api/eu: o profissional da sessão, o estado do perfil e o token CSRF da sessão (o app perde
// o token da memória ao recarregar a página; o cookie é HttpOnly). PERF-01 considera o perfil
// completo com nome e especialidade; a especialidade só existe a partir da etapa de perfil
// (migration do perfil), então até lá nenhum perfil está completo.

export const rotasEu = new Hono<AmbienteAutenticado>().get('/eu', ...autenticada, async (c) => {
  const usuario = await c.var.trx
    .selectFrom('usuario')
    .select(['id', 'email', 'nome'])
    .where('id', '=', c.var.usuarioId)
    .executeTakeFirstOrThrow();
  return c.json({
    usuario,
    perfil: { completo: false },
    csrf_token: await csrfDaSessao(c.var.sid),
  });
});
