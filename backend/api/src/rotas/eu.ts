import { perfilCompleto } from '@es/dominio/perfil/perfil';
import { Hono } from 'hono';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { csrfDaSessao } from '../tokens.ts';

// GET /api/eu: o profissional da sessão, o estado do perfil e o token CSRF da sessão (o app perde
// o token da memória ao recarregar a página; o cookie é HttpOnly). PERF-01 considera o perfil
// completo com nome e especialidade; sem perfil salvo, ele está incompleto.

export const rotasEu = new Hono<AmbienteAutenticado>().get('/eu', ...autenticada, async (c) => {
  const usuario = await c.var.trx
    .selectFrom('usuario')
    .select(['id', 'email', 'nome'])
    .where('id', '=', c.var.usuarioId)
    .executeTakeFirstOrThrow();
  const perfil = await c.var.trx
    .selectFrom('perfil')
    .select(['nome', 'especialidade'])
    .where('usuario_id', '=', c.var.usuarioId)
    .executeTakeFirst();
  return c.json({
    usuario,
    perfil: { completo: perfilCompleto(perfil ?? null) },
    csrf_token: await csrfDaSessao(c.var.sid),
  });
});
