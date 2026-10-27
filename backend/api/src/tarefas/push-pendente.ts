import {
  JANELA_PENDENCIA_MS,
  chaveEvolucaoPendente,
  diaEmBrasilia,
  emJanelaPendencia,
} from '@es/dominio/push/janelas';
import { sql } from 'kysely';
import { comTransacao } from '../db.ts';
import type { EnvioPush } from '../integracoes/push-lotes.ts';
import type { ConfigVapid, MensagemPush } from '../integracoes/push.ts';
import type { Tarefa } from './despachar.ts';
import { entregarAvisos, enviosDoAviso } from './push-avisos.ts';
import { vapidDoAmbiente } from './push-sessao.ts';

// PUSH-03, PUSH-05 (D-23; ADR-010, ADR-011): tarefa do cron que, às 20:00 de Brasília, avisa o
// profissional que tem sessões realizadas no dia sem evolução, com a quantidade, uma vez por dia.
// - Só roda na janela das 20:00 às 21:00 (exclusivo) de Brasília (T141; a hora seguinte compensa
//   execução perdida). Fora dela, nada é lido nem enviado.
// - Lista, entre todos os profissionais, quem tem sessões `realizada` do dia de Brasília sem
//   evolução, push ativo e ainda não recebeu o aviso do dia (tarefas.listar_pendencias_evolucao,
//   migration 0019), até `limite` por execução; o resto sai nas execuções seguintes da janela.
// - Para cada um: grava 'evolucao_pendente' com o dia como ref antes de enviar, numa transação
//   dele (push-avisos.ts); quem não gravou não envia. Erro num item vai ao Sentry e não impede os
//   demais. Sem pendências, nada é gravado nem enviado.
// - PUSH-05: o corpo traz só a quantidade, sem nome de paciente nem texto clínico; o clique abre
//   o Início (PUSH-08), que lista as sessões do dia.
// - Sem as chaves VAPID no ambiente, o push está desligado: nada é gravado nem enviado.

export const NOME_TAREFA_PUSH_PENDENTE = 'push_pendente';
export const URL_AVISO_PENDENTE = '/app';
// PREMISSA: o aviso vale até o fim do dia; enviado das 20:00 às 21:00, 3 h o cobrem.
export const TTL_AVISO_PENDENTE_S = 3 * 60 * 60;

export const mensagemEvolucaoPendente = (quantidade: number): MensagemPush => ({
  titulo: 'Evoluções pendentes',
  corpo:
    quantidade === 1
      ? 'Você tem 1 sessão de hoje sem evolução.'
      : `Você tem ${quantidade} sessões de hoje sem evolução.`,
  url: URL_AVISO_PENDENTE,
});

export interface OpcoesTarefaPushPendente {
  vapid?: (env: Cloudflare.Env) => ConfigVapid | null;
  fetch?: typeof fetch;
}

interface Pendencia {
  usuario_id: string;
  quantidade: number;
}

export function tarefaPushPendente(opcoes: OpcoesTarefaPushPendente = {}): Tarefa {
  const lerVapid = opcoes.vapid ?? vapidDoAmbiente;
  return {
    nome: NOME_TAREFA_PUSH_PENDENTE,
    // A janela das 20:00 às 21:00 já cobre uma execução perdida; `desde` não é usado.
    janelaMs: JANELA_PENDENCIA_MS,
    async executar(ctx) {
      if (!emJanelaPendencia(ctx.agora)) return;
      const vapid = lerVapid(ctx.env);
      if (vapid === null) return;
      const dia = diaEmBrasilia(ctx.agora);
      const pendencias = await comTransacao(ctx.env, null, async (trx) => {
        const { rows } = await sql<Pendencia>`
          select usuario_id, quantidade
          from tarefas.listar_pendencias_evolucao(${dia}::date, ${ctx.limite}::integer)`.execute(
          trx,
        );
        return rows;
      });
      const chave = chaveEvolucaoPendente(ctx.agora);
      const envios: EnvioPush[] = [];
      for (const { usuario_id, quantidade } of pendencias) {
        try {
          envios.push(
            ...(await enviosDoAviso(
              ctx.env,
              usuario_id,
              chave,
              mensagemEvolucaoPendente(Number(quantidade)),
            )),
          );
        } catch (erro) {
          ctx.capturarErro(erro);
        }
      }
      entregarAvisos(ctx, envios, {
        vapid,
        ttlSegundos: TTL_AVISO_PENDENTE_S,
        fetch: opcoes.fetch,
      });
    },
  };
}
