import type { Tarefa } from './despachar.ts';

// PUSH-07 (ADR-010): ponto único de registro das tarefas do cron. O despachante roda esta lista
// em ordem, a cada 5 minutos. Ordem do design (tarefas do cron), cada uma entrando na sua tarefa:
//   1. lembrete de sessão, janela de 15 a 10 min (T144)
//   2. pendência das 20:00 (T145)
//   3. avisos de plano e fim de trial (T146)
//   4. transições de assinatura (T137)
//   5. purga de contas (T152)
//   6. limpeza de tokens e sessões vencidos (T139)
// Tarefa nova: um objeto Tarefa (nome, janela, executar) na posição dela nesta lista.
export const TAREFAS: readonly Tarefa[] = [];
