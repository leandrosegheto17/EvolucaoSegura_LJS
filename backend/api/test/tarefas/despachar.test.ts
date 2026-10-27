import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index.ts';
import {
  type ContextoTarefa,
  INTERVALO_CRON_MS,
  LOTE_POR_EXECUCAO,
  type Tarefa,
  criarAgendado,
  despachar,
} from '../../src/tarefas/despachar.ts';

// T136 / PUSH-07, PLANO-04 (ADR-010): um único Cron Trigger a cada 5 minutos chama o despachante,
// que roda as tarefas registradas em ordem. Critérios de aceite:
// - tarefa que falha não impede as demais (o erro vai ao Sentry com o nome da tarefa);
// - execução perdida é compensada na seguinte, dentro da janela da tarefa;
// - cada tarefa recebe o mesmo `agora` (o horário agendado do cron, não o relógio do processo) e
//   o orçamento por execução (lote).

const MINUTO = 60_000;
const ctxFalso = () => {
  const pendentes: Promise<unknown>[] = [];
  return { emSegundoPlano: (p: Promise<unknown>) => void pendentes.push(p), pendentes };
};

function tarefaQueAnota(nome: string, registro: string[], erro?: Error): Tarefa {
  return {
    nome,
    janelaMs: null,
    async executar() {
      registro.push(nome);
      if (erro) throw erro;
    },
  };
}

describe('despachar: ordem e falhas', () => {
  it('chama as tarefas na ordem do registro, com o mesmo agora e o lote', async () => {
    const vistos: { nome: string; agora: Date; limite: number }[] = [];
    const agora = new Date('2026-10-27T13:00:00.000Z');
    const tarefa = (nome: string): Tarefa => ({
      nome,
      janelaMs: null,
      async executar(ctx) {
        vistos.push({ nome, agora: ctx.agora, limite: ctx.limite });
      },
    });

    await despachar(agora, env, {
      tarefas: [tarefa('primeira'), tarefa('segunda'), tarefa('terceira')],
      capturarErro: () => {},
      ...ctxFalso(),
    });

    expect(vistos).toEqual([
      { nome: 'primeira', agora, limite: LOTE_POR_EXECUCAO },
      { nome: 'segunda', agora, limite: LOTE_POR_EXECUCAO },
      { nome: 'terceira', agora, limite: LOTE_POR_EXECUCAO },
    ]);
  });

  it('tarefa que falha não impede as seguintes e o erro vai ao Sentry com o nome', async () => {
    const registro: string[] = [];
    const erros: { erro: unknown; tarefa: string }[] = [];
    const falha = new Error('banco fora');

    const resultado = await despachar(new Date(), env, {
      tarefas: [
        tarefaQueAnota('a', registro),
        tarefaQueAnota('b', registro, falha),
        tarefaQueAnota('c', registro),
      ],
      capturarErro: (erro, extra) => erros.push({ erro, tarefa: extra.tarefa }),
      ...ctxFalso(),
    });

    expect(registro).toEqual(['a', 'b', 'c']);
    expect(erros).toEqual([{ erro: falha, tarefa: 'b' }]);
    expect(resultado).toEqual([
      { nome: 'a', ok: true },
      { nome: 'b', ok: false },
      { nome: 'c', ok: true },
    ]);
  });

  it('várias tarefas que falham são todas registradas e nenhuma derruba o despachante', async () => {
    const erros: string[] = [];
    const resultado = await despachar(new Date(), env, {
      tarefas: [
        tarefaQueAnota('x', [], new Error('1')),
        {
          nome: 'sincrona',
          janelaMs: null,
          executar: () => {
            throw new Error('2');
          },
        },
      ],
      capturarErro: (_erro, extra) => erros.push(extra.tarefa),
      ...ctxFalso(),
    });
    expect(erros).toEqual(['x', 'sincrona']);
    expect(resultado.map((r) => r.ok)).toEqual([false, false]);
  });
});

// Tarefa de referência que trabalha por janela e é idempotente pelo que já fez (como as de push
// farão com notificacao_enviada): faz cada item com instante em (desde, agora] ainda não feito.
function tarefaPorJanela(janelaMs: number, itens: Date[]) {
  const feitos = new Map<number, Date>();
  const tarefa: Tarefa = {
    nome: 'por-janela',
    janelaMs,
    async executar(ctx: ContextoTarefa) {
      for (const item of itens) {
        const t = item.getTime();
        const dentro = (ctx.desde === null || t > ctx.desde.getTime()) && t <= ctx.agora.getTime();
        if (dentro && !feitos.has(t)) feitos.set(t, ctx.agora);
      }
    },
  };
  return { tarefa, feitos };
}

describe('despachar: execução perdida é compensada dentro da janela', () => {
  const base = new Date('2026-10-27T13:00:00.000Z').getTime();
  const em = (minutos: number) => new Date(base + minutos * MINUTO);
  const rodar = (tarefa: Tarefa, minutos: number) =>
    despachar(em(minutos), env, { tarefas: [tarefa], capturarErro: () => {}, ...ctxFalso() });

  it('o item da execução perdida sai na seguinte, uma vez só', async () => {
    const { tarefa, feitos } = tarefaPorJanela(3 * INTERVALO_CRON_MS, [em(-1), em(3)]);

    await rodar(tarefa, 0); // 13:00 faz o item das 12:59
    // 13:05 perdida (Cloudflare não chamou): o item das 13:03 fica para a seguinte
    await rodar(tarefa, 10);
    await rodar(tarefa, 15);

    expect([...feitos.entries()]).toEqual([
      [em(-1).getTime(), em(0)],
      [em(3).getTime(), em(10)],
    ]);
  });

  it('item mais antigo que a janela da tarefa não é feito', async () => {
    const { tarefa, feitos } = tarefaPorJanela(2 * INTERVALO_CRON_MS, [em(1)]);

    await rodar(tarefa, 0);
    // 13:05 e 13:10 perdidas; às 13:15 a janela de 10 min começa às 13:05.
    await rodar(tarefa, 15);

    expect(feitos.size).toBe(0);
  });

  it('desde = agora - janela; tarefa sem janela recebe desde nulo', async () => {
    const vistos: (Date | null)[] = [];
    const comJanela = (janelaMs: number | null): Tarefa => ({
      nome: `j${janelaMs}`,
      janelaMs,
      async executar(ctx) {
        vistos.push(ctx.desde);
      },
    });
    await despachar(em(0), env, {
      tarefas: [comJanela(10 * MINUTO), comJanela(null)],
      capturarErro: () => {},
      ...ctxFalso(),
    });
    expect(vistos).toEqual([em(-10), null]);
  });
});

describe('handler scheduled', () => {
  it('usa o horário agendado do cron como agora', async () => {
    const vistos: Date[] = [];
    const agendado = criarAgendado({
      tarefas: [
        {
          nome: 'relogio',
          janelaMs: null,
          async executar(ctx) {
            vistos.push(ctx.agora);
          },
        },
      ],
      capturarErro: () => {},
    });
    const { emSegundoPlano } = ctxFalso();
    const horario = Date.parse('2026-10-27T13:05:00.000Z');

    await agendado({ scheduledTime: horario, cron: '*/5 * * * *', noRetry() {} }, env, {
      waitUntil: emSegundoPlano,
    });

    expect(vistos).toEqual([new Date(horario)]);
  });

  it('o Worker exporta o handler scheduled', () => {
    expect(typeof worker.scheduled).toBe('function');
  });
});
