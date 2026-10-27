import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ContextoTarefa } from '../../src/tarefas/despachar.ts';
import { tarefaPushPendente } from '../../src/tarefas/push-pendente.ts';
import { TAREFAS } from '../../src/tarefas/registro.ts';
import { comoAdmin, emailUnico } from '../apoio.ts';
import { decifrarPush, navegadorDePush, vapidDeTeste } from './push-apoio.ts';

// T145 / PUSH-03, PUSH-05: às 20:00 de Brasília, se há sessões realizadas no dia sem evolução,
// o profissional recebe um push com a quantidade, uma vez por dia. Critérios: sem pendências nada
// é enviado; uma vez por dia; corpo só com a quantidade.
// O cron roda de 5 em 5 minutos; aqui as execuções são simuladas com `agora` explícito. A janela
// vai das 20:00 às 21:00 (exclusivo), a hora seguinte compensa execução perdida (T141). O serviço
// de push é simulado por fetch; o teste decifra o corpo como o navegador.
// Isolamento no banco de teste compartilhado: cada execução do arquivo usa um dia sorteado entre
// 2040 e 2067, e cada teste o próprio dia.

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
// 00:00 em Brasília (03:00Z) de um dia sorteado.
const BASE = new Date(Date.UTC(2040, 0, 1, 3, 0, 0) + Math.floor(Math.random() * 10_000) * DIA);
let diaSeguinte = 0;
// Meia-noite (Brasília) de um dia só deste teste; há folga de um dia entre os testes.
const novoDia = () => new Date(BASE.getTime() + (diaSeguinte += 2) * DIA);
const as = (meiaNoite: Date, horas: number, minutos = 0) =>
  new Date(meiaNoite.getTime() + horas * HORA + minutos * MIN);

interface Chamada {
  endpoint: string;
  corpo: Uint8Array;
}

function servicoDePush(status = 201) {
  const chamadas: Chamada[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ endpoint: String(url), corpo: new Uint8Array(init!.body as ArrayBuffer) });
    return new Response(null, { status });
  }) as typeof fetch;
  return { fn, chamadas };
}

async function profissional() {
  const [u] = await comoAdmin<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em) values ($1, 'Ana Souza', now()) returning id`,
    [emailUnico('push-pendente')],
  );
  const [p] = await comoAdmin<{ id: string }>(
    `insert into paciente (usuario_id, nome) values ($1, 'Joana Paciente Sigilosa') returning id`,
    [u!.id],
  );
  return { usuarioId: u!.id, pacienteId: p!.id };
}

async function ativarPush(usuarioId: string) {
  const nav = await navegadorDePush();
  const endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
  await comoAdmin(
    `insert into push_subscription (usuario_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)`,
    [usuarioId, endpoint, nav.p256dh, nav.auth],
  );
  return { nav, endpoint };
}

async function sessao(usuarioId: string, pacienteId: string, inicio: Date, status = 'realizada') {
  const [linha] = await comoAdmin<{ id: string }>(
    `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim, status)
     values ($1, $2, $3, $4, $5) returning id`,
    [usuarioId, pacienteId, inicio, new Date(inicio.getTime() + 50 * MIN), status],
  );
  return linha!.id;
}

async function evoluir(usuarioId: string, pacienteId: string, sessaoId: string) {
  await comoAdmin(
    `insert into evolucao (usuario_id, paciente_id, sessao_id, texto)
     values ($1, $2, $3, 'Relato clínico sigiloso')`,
    [usuarioId, pacienteId, sessaoId],
  );
}

const avisos = (usuarioId: string) =>
  comoAdmin<{ tipo: string; ref: string }>(
    `select tipo, ref from notificacao_enviada where usuario_id = $1 order by ref`,
    [usuarioId],
  );

// Roda a tarefa como o despachante, esperando o que ela entrega ao waitUntil.
async function rodar(agora: Date, servico: typeof fetch, vapid: 'com' | 'sem' = 'com') {
  const chaves = await vapidDeTeste();
  const segundoPlano: Promise<unknown>[] = [];
  const erros: unknown[] = [];
  const ctx: ContextoTarefa = {
    agora,
    desde: null,
    limite: 10,
    env,
    emSegundoPlano: (p) => segundoPlano.push(p),
    capturarErro: (e) => erros.push(e),
  };
  await tarefaPushPendente({
    vapid: () => (vapid === 'com' ? chaves : null),
    fetch: servico,
  }).executar(ctx);
  await Promise.all(segundoPlano);
  return { erros };
}

describe('sem pendências, nada é enviado (PUSH-03)', () => {
  it('sem sessão realizada no dia: nada é enviado nem gravado', async () => {
    const { usuarioId } = await profissional();
    await ativarPush(usuarioId);
    const servico = servicoDePush();
    const { erros } = await rodar(as(novoDia(), 20), servico.fn);
    expect(erros).toEqual([]);
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });

  it('todas as sessões realizadas do dia com evolução: nada é enviado', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const dia = novoDia();
    await evoluir(usuarioId, pacienteId, await sessao(usuarioId, pacienteId, as(dia, 9)));
    await evoluir(usuarioId, pacienteId, await sessao(usuarioId, pacienteId, as(dia, 14)));
    const servico = servicoDePush();
    await rodar(as(dia, 20), servico.fn);
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });

  it('sessões não realizadas, ou de outro dia, não são pendência', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const dia = novoDia();
    for (const status of ['agendada', 'faltou', 'cancelada', 'remarcada'])
      await sessao(usuarioId, pacienteId, as(dia, 10), status);
    await sessao(usuarioId, pacienteId, as(dia, -1));
    await sessao(usuarioId, pacienteId, as(dia, 24));
    const servico = servicoDePush();
    await rodar(as(dia, 20), servico.fn);
    expect(servico.chamadas).toEqual([]);
  });
});

describe('uma vez por dia, às 20:00 de Brasília (PUSH-03)', () => {
  it('só a execução das 20:00 envia; as das 20:05 e 20:55 não repetem', async () => {
    const { usuarioId, pacienteId } = await profissional();
    const { endpoint } = await ativarPush(usuarioId);
    const dia = novoDia();
    await sessao(usuarioId, pacienteId, as(dia, 14));
    const servico = servicoDePush();
    const porExecucao: Record<string, number> = {};
    for (const [rotulo, h, m] of [
      ['19:55', 19, 55],
      ['20:00', 20, 0],
      ['20:05', 20, 5],
      ['20:55', 20, 55],
      ['21:00', 21, 0],
    ] as const) {
      const antes = servico.chamadas.length;
      const { erros } = await rodar(as(dia, h, m), servico.fn);
      expect(erros, rotulo).toEqual([]);
      porExecucao[rotulo] = servico.chamadas.length - antes;
    }
    expect(porExecucao).toEqual({ '19:55': 0, '20:00': 1, '20:05': 0, '20:55': 0, '21:00': 0 });
    expect(servico.chamadas[0]!.endpoint).toBe(endpoint);
  });

  it('antes das 20:00 nada é enviado nem gravado', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const dia = novoDia();
    await sessao(usuarioId, pacienteId, as(dia, 9));
    const servico = servicoDePush();
    await rodar(as(dia, 19, 55), servico.fn);
    await rodar(as(dia, 12), servico.fn);
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });

  it('se a execução das 20:00 se perdeu, a das 20:05 envia (uma vez)', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const dia = novoDia();
    await sessao(usuarioId, pacienteId, as(dia, 14));
    const servico = servicoDePush();
    await rodar(as(dia, 20, 5), servico.fn);
    await rodar(as(dia, 20, 10), servico.fn);
    expect(servico.chamadas).toHaveLength(1);
  });

  it('nova pendência depois do envio do dia não gera outro aviso no mesmo dia', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const dia = novoDia();
    await sessao(usuarioId, pacienteId, as(dia, 14));
    const servico = servicoDePush();
    await rodar(as(dia, 20), servico.fn);
    await sessao(usuarioId, pacienteId, as(dia, 19));
    await rodar(as(dia, 20, 5), servico.fn);
    expect(servico.chamadas).toHaveLength(1);
  });

  it('no dia seguinte, com nova pendência, sai o aviso desse dia', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const dia = novoDia();
    const amanha = new Date(dia.getTime() + DIA);
    await sessao(usuarioId, pacienteId, as(dia, 14));
    await sessao(usuarioId, pacienteId, as(amanha, 14));
    const servico = servicoDePush();
    await rodar(as(dia, 20), servico.fn);
    await rodar(as(amanha, 20), servico.fn);
    expect(servico.chamadas).toHaveLength(2);
    const ref = (d: Date) => new Date(d.getTime() - 3 * HORA).toISOString().slice(0, 10);
    expect(await avisos(usuarioId)).toEqual([
      { tipo: 'evolucao_pendente', ref: ref(as(dia, 12)) },
      { tipo: 'evolucao_pendente', ref: ref(as(amanha, 12)) },
    ]);
  });

  it('execuções sobrepostas não repetem o aviso', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const dia = novoDia();
    await sessao(usuarioId, pacienteId, as(dia, 14));
    const servico = servicoDePush();
    await Promise.all([rodar(as(dia, 20), servico.fn), rodar(as(dia, 20), servico.fn)]);
    expect(servico.chamadas).toHaveLength(1);
    expect(await avisos(usuarioId)).toHaveLength(1);
  });

  it('cada dispositivo do profissional recebe o aviso, uma vez; outro profissional não', async () => {
    const a = await profissional();
    const b = await profissional();
    const um = await ativarPush(a.usuarioId);
    const dois = await ativarPush(a.usuarioId);
    await ativarPush(b.usuarioId);
    const dia = novoDia();
    await sessao(a.usuarioId, a.pacienteId, as(dia, 14));
    const servico = servicoDePush();
    await rodar(as(dia, 20), servico.fn);
    await rodar(as(dia, 20, 5), servico.fn);
    expect(servico.chamadas.map((c) => c.endpoint).sort()).toEqual(
      [um.endpoint, dois.endpoint].sort(),
    );
    expect(await avisos(b.usuarioId)).toEqual([]);
  });

  it('sem as chaves VAPID o push está desligado: nada é enviado nem gravado', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const dia = novoDia();
    await sessao(usuarioId, pacienteId, as(dia, 14));
    const servico = servicoDePush();
    await rodar(as(dia, 20), servico.fn, 'sem');
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });
});

describe('corpo só com a quantidade (PUSH-03, PUSH-05)', () => {
  it('o navegador recebe o título, a quantidade e a tela do Início, nada do paciente', async () => {
    const { usuarioId, pacienteId } = await profissional();
    const { nav } = await ativarPush(usuarioId);
    const dia = novoDia();
    const ids = [
      await sessao(usuarioId, pacienteId, as(dia, 9)),
      await sessao(usuarioId, pacienteId, as(dia, 11)),
      await sessao(usuarioId, pacienteId, as(dia, 15)),
    ];
    await evoluir(usuarioId, pacienteId, await sessao(usuarioId, pacienteId, as(dia, 16)));
    const servico = servicoDePush();
    await rodar(as(dia, 20), servico.fn);
    const texto = await decifrarPush(nav, servico.chamadas[0]!.corpo);
    expect(JSON.parse(texto)).toEqual({
      titulo: 'Evoluções pendentes',
      corpo: 'Você tem 3 sessões de hoje sem evolução.',
      url: '/app',
    });
    for (const proibido of ['Joana', 'Paciente', 'Sigilosa', 'Relato', pacienteId, ...ids])
      expect(texto, proibido).not.toContain(proibido);
  });

  it('com uma sessão pendente, o corpo fica no singular', async () => {
    const { usuarioId, pacienteId } = await profissional();
    const { nav } = await ativarPush(usuarioId);
    const dia = novoDia();
    await sessao(usuarioId, pacienteId, as(dia, 9));
    const servico = servicoDePush();
    await rodar(as(dia, 20), servico.fn);
    const texto = await decifrarPush(nav, servico.chamadas[0]!.corpo);
    expect(JSON.parse(texto).corpo).toBe('Você tem 1 sessão de hoje sem evolução.');
  });
});

describe('registro no despachante (ADR-010)', () => {
  it('é a segunda tarefa da lista, depois do aviso de sessão, como no design', () => {
    expect(TAREFAS.map((t) => t.nome).slice(0, 2)).toEqual(['push_sessao', 'push_pendente']);
  });
});
