import {
  PROBLEMA_ENDPOINT_EM_USO,
  esquemaAtivarPush,
  esquemaDesativarPush,
} from '@es/contrato/push';
import type { ChavePush } from '@es/contrato/push';
import { Hono } from 'hono';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';
import { vapidDoAmbiente } from '../tarefas/push-sessao.ts';

// PUSH-01, PERF-08: ativar e desativar o push do dispositivo, rotas autenticadas.
// - POST /api/push/assinatura guarda a assinatura (PushSubscription.toJSON do navegador). O mesmo
//   endpoint não duplica: se já é do profissional, só as chaves são atualizadas. 204 nos dois
//   casos. Endpoint já ativo para outro profissional: 409 endpoint_em_uso, sem tocar na linha
//   dele (PREMISSA; o RLS não a mostra, e a inclusão sem conflito nem atualização revela que ela
//   existe). Sem erro de banco: ON CONFLICT DO NOTHING e depois UPDATE limitado pelo RLS.
// - DELETE /api/push/assinatura remove a assinatura do endpoint dado. 204 também quando não há o
//   que remover (desativar de novo, ou endpoint de outro profissional, que o RLS esconde: nada
//   muda, ISO-02).
// - GET /api/push/chave (T179) entrega a chave pública VAPID, que o navegador passa ao
//   PushManager.subscribe. Sem as três chaves VAPID o push está desligado (como nas tarefas do
//   cron): chave_publica null. Nunca expõe a privada.
// Sem auditoria: a spec não lista evento para o push.

export const rotasPush = new Hono<AmbienteAutenticado>()
  .get('/push/chave', ...autenticada, (c) => {
    const corpo: ChavePush = { chave_publica: vapidDoAmbiente(c.env)?.chavePublica ?? null };
    return c.json(corpo);
  })
  .post('/push/assinatura', ...autenticada, async (c) => {
    const leitura = await lerCorpo(c, esquemaAtivarPush);
    if (!leitura.ok) return leitura.resposta;
    const { endpoint, keys } = leitura.dados;
    const { trx, usuarioId } = c.var;
    const criada = await trx
      .insertInto('push_subscription')
      .values({ usuario_id: usuarioId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflict((oc) => oc.column('endpoint').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (criada) return c.body(null, 204);
    const atualizada = await trx
      .updateTable('push_subscription')
      .set({ p256dh: keys.p256dh, auth: keys.auth })
      .where('endpoint', '=', endpoint)
      .returning('id')
      .executeTakeFirst();
    if (!atualizada) return responderProblema(c, PROBLEMA_ENDPOINT_EM_USO);
    return c.body(null, 204);
  })
  .delete('/push/assinatura', ...autenticada, async (c) => {
    const leitura = await lerCorpo(c, esquemaDesativarPush);
    if (!leitura.ok) return leitura.resposta;
    await c.var.trx
      .deleteFrom('push_subscription')
      .where('endpoint', '=', leitura.dados.endpoint)
      .execute();
    return c.body(null, 204);
  });
