import { sql } from 'kysely';
import { comTransacao } from '../db.ts';
import type { Tarefa } from './despachar.ts';

// CONTA-05 (T152): tarefa do cron que purga as contas cuja exclusão foi confirmada há 30 dias
// (DIAS_ATE_PURGA) sem desistência, pela função tarefas.purgar_contas (migration 0023): apaga
// todas as linhas do profissional, auditoria inclusive, e guarda só conta_excluida (id, data do
// pedido, data da purga). Até `limite` contas por execução (orçamento do cron, ADR-010), das
// bloqueadas há mais tempo; o resto fica para a seguinte. Sem janela: o estado (a conta bloqueada
// ainda existir) diz o que falta, então uma execução perdida é coberta pela seguinte e a
// reexecução é inofensiva (a conta purgada já não existe). Uma instrução só no banco.

export const NOME_TAREFA_PURGA = 'purga';

export function tarefaPurga(): Tarefa {
  return {
    nome: NOME_TAREFA_PURGA,
    janelaMs: null,
    async executar({ agora, limite, env }) {
      await comTransacao(env, null, (trx) =>
        sql`select tarefas.purgar_contas(${agora}::timestamptz, ${limite}::integer)`.execute(trx),
      );
    },
  };
}
