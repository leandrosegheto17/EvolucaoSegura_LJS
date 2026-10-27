import type { ChaveNotificacao } from '@es/dominio/push/janelas';
import { comTransacao } from '../db.ts';
import { type EnvioPush, enviarEmLotes } from '../integracoes/push-lotes.ts';
import {
  type AssinaturaPush,
  type ConfigVapid,
  type MensagemPush,
  removerAssinaturaMorta,
} from '../integracoes/push.ts';
import type { ContextoTarefa } from './despachar.ts';

// PUSH-03, PUSH-04 (ADR-010, ADR-011): passos comuns das tarefas de aviso por push (pendência,
// cobrança, fim de trial), no mesmo desenho da tarefa de sessão próxima (T144).
// - enviosDoAviso: numa transação do próprio profissional (RLS), grava a chave do aviso em
//   notificacao_enviada ANTES de enviar (ON CONFLICT DO NOTHING; quem não gravou não envia, então
//   execuções sobrepostas não repetem o aviso) e monta um envio por assinatura dele. Depois de
//   gravado, o envio que falhar não é refeito (no máximo uma vez).
// - entregarAvisos: entrega os envios ao waitUntil, em lotes (push-lotes.ts); 404 e 410 removem
//   a assinatura (PUSH-06). A tarefa não espera os envios.

export async function enviosDoAviso(
  env: Cloudflare.Env,
  usuarioId: string,
  chave: ChaveNotificacao,
  mensagem: MensagemPush,
): Promise<EnvioPush[]> {
  return comTransacao(env, usuarioId, async (trx) => {
    const gravada = await trx
      .insertInto('notificacao_enviada')
      .values({ usuario_id: usuarioId, tipo: chave.tipo, ref: chave.ref })
      .onConflict((oc) => oc.columns(['usuario_id', 'tipo', 'ref']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!gravada) return [];
    const assinaturas = await trx
      .selectFrom('push_subscription')
      .select(['id', 'endpoint', 'p256dh', 'auth'])
      .where('usuario_id', '=', usuarioId)
      .orderBy('criado_em')
      .execute();
    return assinaturas.map((a): EnvioPush => ({
      assinatura: { ...a, usuarioId } satisfies AssinaturaPush,
      mensagem,
    }));
  });
}

export function entregarAvisos(
  ctx: ContextoTarefa,
  envios: readonly EnvioPush[],
  opcoes: { vapid: ConfigVapid; ttlSegundos: number; fetch?: typeof fetch | undefined },
): void {
  if (envios.length === 0) return;
  void enviarEmLotes(envios, {
    vapid: opcoes.vapid,
    agora: ctx.agora,
    ttlSegundos: opcoes.ttlSegundos,
    removerAssinatura: removerAssinaturaMorta(ctx.env),
    emSegundoPlano: ctx.emSegundoPlano,
    capturarErro: ctx.capturarErro,
    ...(opcoes.fetch ? { fetch: opcoes.fetch } : {}),
  });
}
