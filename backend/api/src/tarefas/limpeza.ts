import { sql } from 'kysely';
import { comTransacao } from '../db.ts';
import type { Tarefa } from './despachar.ts';

// CAD-03, AUTH-09 (T139): tarefa do cron que marca como vencidos os tokens de e-mail e as sessões
// cujo tempo acabou, pela função tarefas.vencer_tokens_e_sessoes (migration 0016): invalida o
// token aberto com expira_em <= agora e encerra a sessão aberta com 15 minutos sem uso ou 12 horas
// desde o login. Só marca (a app não tem DELETE). Registros válidos, usados ou já encerrados não
// mudam, então a reexecução é inofensiva. Sem janela: o que venceu até agora é marcado, e uma
// execução perdida é coberta pela seguinte. Uma instrução só no banco, sem trabalho por item no
// Worker (o lote do despachante não se aplica).

export const NOME_TAREFA_LIMPEZA = 'limpeza';

export function tarefaLimpeza(): Tarefa {
  return {
    nome: NOME_TAREFA_LIMPEZA,
    janelaMs: null,
    async executar({ agora, env }) {
      await comTransacao(env, null, (trx) =>
        sql`select * from tarefas.vencer_tokens_e_sessoes(${agora}::timestamptz)`.execute(trx),
      );
    },
  };
}
