import {
  ANTECEDENCIA_MAXIMA_SESSAO_MS,
  ANTECEDENCIA_MINIMA_SESSAO_MS,
  FUSO_BRASILIA,
  chaveSessaoProxima,
  intervaloSessaoProxima,
} from '@es/dominio/push/janelas';
import { sql } from 'kysely';
import { comTransacao } from '../db.ts';
import { type EnvioPush, enviarEmLotes } from '../integracoes/push-lotes.ts';
import {
  type AssinaturaPush,
  type ConfigVapid,
  type MensagemPush,
  removerAssinaturaMorta,
} from '../integracoes/push.ts';
import type { ContextoTarefa, Tarefa } from './despachar.ts';

// PUSH-02, PUSH-05 (D-22; ADR-010, ADR-011): tarefa do cron que avisa "sessão próxima" quando
// faltam de 15 a 10 minutos para uma sessão agendada (janela da T141), uma única vez por sessão.
// - Lista, entre todos os profissionais, as sessões do intervalo do domínio que ainda não foram
//   avisadas e cujo profissional tem push ativo (tarefas.listar_sessoes_para_aviso, migration
//   0018), até `limite` por execução.
// - Para cada sessão, numa transação do próprio profissional (RLS): grava 'sessao_proxima' em
//   notificacao_enviada ANTES de enviar (ON CONFLICT DO NOTHING; quem não gravou não envia, então
//   execuções sobrepostas não repetem o aviso) e lê as assinaturas dele. Erro num item vai ao
//   Sentry e não impede os demais. Depois de gravado, o envio que falhar não é refeito (no máximo
//   uma vez, PUSH-02).
// - Envio em lotes no waitUntil (push-lotes.ts); 404 e 410 removem a assinatura (PUSH-06).
// - PUSH-05: o corpo traz só o horário (America/Sao_Paulo), sem nome de paciente nem texto
//   clínico; o clique abre a agenda (PUSH-08; não há tela própria de sessão).
// - Sem as chaves VAPID no ambiente, o push está desligado: nada é gravado nem enviado.

export const NOME_TAREFA_PUSH_SESSAO = 'push_sessao';
// O aviso deixa de valer quando a sessão começa: o serviço de push o descarta depois de 15 min.
export const TTL_AVISO_SESSAO_S = ANTECEDENCIA_MAXIMA_SESSAO_MS / 1000;
export const URL_AVISO_SESSAO = '/app/agenda';

const horaBrasilia = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_BRASILIA,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const mensagemSessaoProxima = (inicio: Date): MensagemPush => ({
  titulo: 'Sessão próxima',
  corpo: `Sua sessão começa às ${horaBrasilia.format(inicio)}.`,
  url: URL_AVISO_SESSAO,
});

export function vapidDoAmbiente(env: Cloudflare.Env): ConfigVapid | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null;
  return {
    chavePublica: VAPID_PUBLIC_KEY,
    chavePrivada: VAPID_PRIVATE_KEY,
    assunto: VAPID_SUBJECT,
  };
}

export interface OpcoesTarefaPushSessao {
  vapid?: (env: Cloudflare.Env) => ConfigVapid | null;
  fetch?: typeof fetch;
}

interface SessaoParaAviso {
  usuario_id: string;
  sessao_id: string;
  inicio: Date;
}

async function enviosDaSessao(ctx: ContextoTarefa, sessao: SessaoParaAviso): Promise<EnvioPush[]> {
  const chave = chaveSessaoProxima(sessao.sessao_id);
  return comTransacao(ctx.env, sessao.usuario_id, async (trx) => {
    const gravada = await trx
      .insertInto('notificacao_enviada')
      .values({ usuario_id: sessao.usuario_id, tipo: chave.tipo, ref: chave.ref })
      .onConflict((oc) => oc.columns(['usuario_id', 'tipo', 'ref']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!gravada) return [];
    const assinaturas = await trx
      .selectFrom('push_subscription')
      .select(['id', 'endpoint', 'p256dh', 'auth'])
      .where('usuario_id', '=', sessao.usuario_id)
      .orderBy('criado_em')
      .execute();
    const mensagem = mensagemSessaoProxima(new Date(sessao.inicio));
    return assinaturas.map((a): EnvioPush => ({
      assinatura: { ...a, usuarioId: sessao.usuario_id } satisfies AssinaturaPush,
      mensagem,
    }));
  });
}

export function tarefaPushSessao(opcoes: OpcoesTarefaPushSessao = {}): Tarefa {
  const lerVapid = opcoes.vapid ?? vapidDoAmbiente;
  return {
    nome: NOME_TAREFA_PUSH_SESSAO,
    // A janela de 15 a 10 minutos já cobre uma execução perdida; `desde` não é usado.
    janelaMs: ANTECEDENCIA_MAXIMA_SESSAO_MS - ANTECEDENCIA_MINIMA_SESSAO_MS,
    async executar(ctx) {
      const vapid = lerVapid(ctx.env);
      if (vapid === null) return;
      const { de, ate } = intervaloSessaoProxima(ctx.agora);
      const sessoes = await comTransacao(ctx.env, null, async (trx) => {
        const { rows } = await sql<SessaoParaAviso>`
          select usuario_id, sessao_id, inicio
          from tarefas.listar_sessoes_para_aviso(${de}::timestamptz, ${ate}::timestamptz,
                                                 ${ctx.limite}::integer)`.execute(trx);
        return rows;
      });
      const envios: EnvioPush[] = [];
      for (const sessao of sessoes) {
        try {
          envios.push(...(await enviosDaSessao(ctx, sessao)));
        } catch (erro) {
          ctx.capturarErro(erro);
        }
      }
      if (envios.length === 0) return;
      // Entregue ao waitUntil: a tarefa não espera os envios (as seguintes do cron rodam já).
      void enviarEmLotes(envios, {
        vapid,
        agora: ctx.agora,
        ttlSegundos: TTL_AVISO_SESSAO_S,
        removerAssinatura: removerAssinaturaMorta(ctx.env),
        emSegundoPlano: ctx.emSegundoPlano,
        capturarErro: ctx.capturarErro,
        ...(opcoes.fetch ? { fetch: opcoes.fetch } : {}),
      });
    },
  };
}
