import {
  type ChaveNotificacao,
  type TipoEventoCobranca,
  chaveEventoCobranca,
} from '@es/dominio/push/janelas';
import { sql } from 'kysely';
import { comTransacao } from '../db.ts';
import type { EnvioPush } from '../integracoes/push-lotes.ts';
import type { ConfigVapid, MensagemPush } from '../integracoes/push.ts';
import type { Tarefa } from './despachar.ts';
import { entregarAvisos, enviosDoAviso } from './push-avisos.ts';
import { vapidDoAmbiente } from './push-sessao.ts';

// PUSH-04, PUSH-05 (ADR-010, ADR-011): tarefa do cron que avisa por push a cobrança gerada, o
// pagamento confirmado e a cobrança vencida, uma vez por evento.
// - A origem são os eventos do webhook do Asaas já gravados e processados (T129 a T131), com o
//   profissional achado: PAYMENT_CREATED, PAYMENT_RECEIVED ou PAYMENT_CONFIRMED (o mesmo aviso) e
//   PAYMENT_OVERDUE, processados em (desde, agora] (tarefas.listar_eventos_cobranca_para_aviso,
//   migration 0020), de quem tem push ativo e ainda não foi avisado, até `limite` por execução.
// - Uma vez por evento: a chave é (tipo, id do pagamento) em notificacao_enviada, gravada antes de
//   enviar numa transação do profissional (push-avisos.ts); reenvio do webhook, recebido mais
//   confirmado do mesmo pagamento e execuções sobrepostas não repetem o aviso.
// - PREMISSA: o aviso sai para todo evento desses tipos ligado ao profissional, mesmo quando o
//   webhook não mudou o estado da assinatura (diferente do e-mail, PLANO-13); o push só informa o
//   fato. Evento processado há mais de 24 h (janela) não gera push (ex.: push ativado depois).
// - PUSH-05: corpo com texto fixo, sem valor, datas, ids do Asaas, nome de paciente nem texto
//   clínico; o clique abre o Meu plano (PUSH-08).
// - Sem as chaves VAPID no ambiente, o push está desligado: nada é gravado nem enviado.

export const NOME_TAREFA_PUSH_COBRANCA = 'push_cobranca';
export const URL_AVISO_COBRANCA = '/app/plano';
// PREMISSA: até onde um evento ainda merece aviso, e por quanto tempo o serviço de push o guarda.
export const JANELA_AVISO_COBRANCA_MS = 24 * 60 * 60_000;
export const TTL_AVISO_COBRANCA_S = 24 * 60 * 60;

const MENSAGENS: Record<TipoEventoCobranca, MensagemPush> = {
  cobranca_gerada: {
    titulo: 'Nova cobrança',
    corpo: 'A cobrança mensal do Evolução Segura Pro foi gerada. Pague com Pix em Meu plano.',
    url: URL_AVISO_COBRANCA,
  },
  pagamento_confirmado: {
    titulo: 'Pagamento confirmado',
    corpo: 'Recebemos o pagamento do Evolução Segura Pro. Obrigado!',
    url: URL_AVISO_COBRANCA,
  },
  cobranca_vencida: {
    titulo: 'Cobrança vencida',
    corpo: 'A cobrança do Evolução Segura Pro venceu. Pague com Pix em Meu plano.',
    url: URL_AVISO_COBRANCA,
  },
};

export const mensagemEventoCobranca = (tipo: TipoEventoCobranca): MensagemPush => MENSAGENS[tipo];

export interface OpcoesTarefaPushCobranca {
  vapid?: (env: Cloudflare.Env) => ConfigVapid | null;
  fetch?: typeof fetch;
}

interface EventoParaAviso {
  usuario_id: string;
  tipo: TipoEventoCobranca;
  ref: string;
}

export function tarefaPushCobranca(opcoes: OpcoesTarefaPushCobranca = {}): Tarefa {
  const lerVapid = opcoes.vapid ?? vapidDoAmbiente;
  return {
    nome: NOME_TAREFA_PUSH_COBRANCA,
    janelaMs: JANELA_AVISO_COBRANCA_MS,
    async executar(ctx) {
      const vapid = lerVapid(ctx.env);
      if (vapid === null) return;
      const desde = ctx.desde ?? new Date(ctx.agora.getTime() - JANELA_AVISO_COBRANCA_MS);
      const eventos = await comTransacao(ctx.env, null, async (trx) => {
        const { rows } = await sql<EventoParaAviso>`
          select usuario_id, tipo, ref
          from tarefas.listar_eventos_cobranca_para_aviso(${desde}::timestamptz,
                                                          ${ctx.agora}::timestamptz,
                                                          ${ctx.limite}::integer)`.execute(trx);
        return rows;
      });
      const envios: EnvioPush[] = [];
      for (const evento of eventos) {
        try {
          const chave: ChaveNotificacao = chaveEventoCobranca(evento.tipo, evento.ref);
          envios.push(
            ...(await enviosDoAviso(
              ctx.env,
              evento.usuario_id,
              chave,
              mensagemEventoCobranca(evento.tipo),
            )),
          );
        } catch (erro) {
          ctx.capturarErro(erro);
        }
      }
      entregarAvisos(ctx, envios, {
        vapid,
        ttlSegundos: TTL_AVISO_COBRANCA_S,
        fetch: opcoes.fetch,
      });
    },
  };
}
