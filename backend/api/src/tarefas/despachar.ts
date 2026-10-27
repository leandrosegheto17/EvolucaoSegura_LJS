// PUSH-07, PLANO-04 (ADR-010): despachante do Cron Trigger único (`*/5 * * * *` no wrangler.jsonc;
// a conta tem 5 crons divididos entre 3 apps). A cada execução, roda as tarefas registradas em
// ordem, uma depois da outra.
// - Falha isolada: o erro de uma tarefa vai ao Sentry com o nome dela e as seguintes rodam.
// - Tempo: `agora` é o horário agendado do cron (controller.scheduledTime), não o relógio do
//   processo; as tarefas nunca leem Date.now().
// - Compensação: cada tarefa declara a própria janela. Com janela, recebe `desde = agora - janela`
//   e faz o que venceu em (desde, agora] e ainda não foi feito; uma execução perdida é coberta pela
//   seguinte enquanto o item estiver dentro da janela. Sem janela (`null`), a tarefa faz tudo o que
//   venceu até agora (transições de assinatura, limpeza): o estado já diz o que falta.
// - Idempotência: cada tarefa é idempotente pelo estado ou por notificacao_enviada (design), então
//   reexecutar ou sobrepor execuções não repete efeitos.
// - Orçamento de CPU: o Worker Free tem 10 ms de CPU por execução (a espera de rede e banco não
//   conta). Cada tarefa trata no máximo `limite` itens por execução; o resto fica para a seguinte.

export const INTERVALO_CRON_MS = 5 * 60_000;
// PREMISSA: 10 itens por tarefa por execução (2.880 por dia) cabem no orçamento e sobram para o
// volume esperado; ajustar com medição depois do primeiro deploy.
export const LOTE_POR_EXECUCAO = 10;

export type CapturarErroTarefa = (erro: unknown, extra: { tarefa: string }) => void;

export interface ContextoTarefa {
  agora: Date;
  desde: Date | null;
  limite: number;
  env: Cloudflare.Env;
  emSegundoPlano: (tarefa: Promise<unknown>) => void;
  capturarErro: (erro: unknown) => void;
}

export interface Tarefa {
  nome: string;
  // Até quando um item vencido ainda merece ser feito (ms); null = sem limite.
  janelaMs: number | null;
  executar(ctx: ContextoTarefa): Promise<void>;
}

export interface OpcoesDespachar {
  tarefas: readonly Tarefa[];
  capturarErro: CapturarErroTarefa;
  emSegundoPlano: (tarefa: Promise<unknown>) => void;
}

export async function despachar(
  agora: Date,
  env: Cloudflare.Env,
  { tarefas, capturarErro, emSegundoPlano }: OpcoesDespachar,
): Promise<{ nome: string; ok: boolean }[]> {
  const resultado: { nome: string; ok: boolean }[] = [];
  for (const tarefa of tarefas) {
    const registrar = (erro: unknown) => capturarErro(erro, { tarefa: tarefa.nome });
    try {
      await tarefa.executar({
        agora,
        desde: tarefa.janelaMs === null ? null : new Date(agora.getTime() - tarefa.janelaMs),
        limite: LOTE_POR_EXECUCAO,
        env,
        emSegundoPlano,
        capturarErro: registrar,
      });
      resultado.push({ nome: tarefa.nome, ok: true });
    } catch (erro) {
      registrar(erro);
      resultado.push({ nome: tarefa.nome, ok: false });
    }
  }
  return resultado;
}

export function criarAgendado(opcoes: {
  tarefas: readonly Tarefa[];
  capturarErro: CapturarErroTarefa;
}) {
  return async (
    controller: Pick<ScheduledController, 'scheduledTime' | 'cron' | 'noRetry'>,
    env: Cloudflare.Env,
    ctx: Pick<ExecutionContext, 'waitUntil'>,
  ): Promise<void> => {
    await despachar(new Date(controller.scheduledTime), env, {
      ...opcoes,
      emSegundoPlano: (tarefa) => ctx.waitUntil(tarefa),
    });
  };
}
