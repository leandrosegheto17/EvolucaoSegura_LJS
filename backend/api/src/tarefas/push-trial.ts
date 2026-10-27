import { ANTECEDENCIA_TRIAL_MS } from '@es/dominio/push/janelas';
import { sql } from 'kysely';
import { comTransacao } from '../db.ts';
import type { EnvioPush } from '../integracoes/push-lotes.ts';
import type { ConfigVapid, MensagemPush } from '../integracoes/push.ts';
import type { Tarefa } from './despachar.ts';
import { entregarAvisos, enviosDoAviso } from './push-avisos.ts';
import { vapidDoAmbiente } from './push-sessao.ts';

// PUSH-04, PUSH-05 (ADR-010, ADR-011): tarefa do cron que avisa por push que o trial termina em 3
// dias, uma vez por evento (o trial que termina naquele periodo_fim).
// - Lista, entre todos os profissionais, as assinaturas em trial com periodo_fim em
//   (agora, agora + 3 dias] (janela do domínio, T141), de quem tem push ativo e ainda não foi
//   avisado desse fim (tarefas.listar_trials_terminando, migration 0021), até `limite` por
//   execução. Sem janela de compensação: o estado diz o que falta (como a de assinaturas).
// - A chave ('trial_terminando', periodo_fim ISO) vem pronta da função, no formato do domínio
//   (chaveTrialTerminando), e é gravada antes de enviar numa transação do profissional
//   (push-avisos.ts); execuções sobrepostas não repetem o aviso.
// - O corpo diz quantos dias faltam, arredondando para cima (3, 2 ou 1): o aviso pode sair depois
//   do começo da janela (ex.: push ativado com o trial já perto do fim). PUSH-05: sem nome de
//   paciente nem texto clínico; o clique abre o Meu plano (PUSH-08).
// - Sem as chaves VAPID no ambiente, o push está desligado: nada é gravado nem enviado.

export const NOME_TAREFA_PUSH_TRIAL = 'push_trial';
export const URL_AVISO_TRIAL = '/app/plano';
// PREMISSA: o aviso continua útil por um dia no serviço de push.
export const TTL_AVISO_TRIAL_S = 24 * 60 * 60;

const DIA_MS = 24 * 60 * 60_000;
const DIAS_DA_JANELA = ANTECEDENCIA_TRIAL_MS / DIA_MS;

export function diasParaFimDoTrial(periodoFim: Date, agora: Date): number {
  const dias = Math.ceil((periodoFim.getTime() - agora.getTime()) / DIA_MS);
  return Math.min(DIAS_DA_JANELA, Math.max(1, dias));
}

export const mensagemTrialTerminando = (dias: number): MensagemPush => ({
  titulo: 'Seu teste está acabando',
  corpo: `Seu período de teste termina em ${dias} ${dias === 1 ? 'dia' : 'dias'}. Assine em Meu plano para continuar no Pro.`,
  url: URL_AVISO_TRIAL,
});

export interface OpcoesTarefaPushTrial {
  vapid?: (env: Cloudflare.Env) => ConfigVapid | null;
  fetch?: typeof fetch;
}

interface TrialParaAviso {
  usuario_id: string;
  periodo_fim: Date;
  ref: string;
}

export function tarefaPushTrial(opcoes: OpcoesTarefaPushTrial = {}): Tarefa {
  const lerVapid = opcoes.vapid ?? vapidDoAmbiente;
  return {
    nome: NOME_TAREFA_PUSH_TRIAL,
    janelaMs: null,
    async executar(ctx) {
      const vapid = lerVapid(ctx.env);
      if (vapid === null) return;
      const trials = await comTransacao(ctx.env, null, async (trx) => {
        const { rows } = await sql<TrialParaAviso>`
          select usuario_id, periodo_fim, ref
          from tarefas.listar_trials_terminando(${ctx.agora}::timestamptz,
                                                ${ctx.limite}::integer)`.execute(trx);
        return rows;
      });
      const envios: EnvioPush[] = [];
      for (const trial of trials) {
        try {
          const dias = diasParaFimDoTrial(new Date(trial.periodo_fim), ctx.agora);
          envios.push(
            ...(await enviosDoAviso(
              ctx.env,
              trial.usuario_id,
              { tipo: 'trial_terminando', ref: trial.ref },
              mensagemTrialTerminando(dias),
            )),
          );
        } catch (erro) {
          ctx.capturarErro(erro);
        }
      }
      entregarAvisos(ctx, envios, {
        vapid,
        ttlSegundos: TTL_AVISO_TRIAL_S,
        fetch: opcoes.fetch,
      });
    },
  };
}
