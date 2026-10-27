import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ContextoTarefa } from '../../src/tarefas/despachar.ts';
import { tarefaPushSessao } from '../../src/tarefas/push-sessao.ts';
import { TAREFAS } from '../../src/tarefas/registro.ts';
import { comoAdmin, emailUnico } from '../apoio.ts';
import { decifrarPush, navegadorDePush, vapidDeTeste } from './push-apoio.ts';

// T144 / PUSH-02, PUSH-05 (D-22): tarefa do cron que envia o push "sessão próxima" quando faltam
// de 15 a 10 minutos (T141), uma única vez por sessão. Critérios: sessão às 14:00 gera um envio
// entre 13:45 e 13:50 e nenhum outro; o corpo não traz nome de paciente nem texto clínico.
// O cron roda de 5 em 5 minutos; aqui as execuções são simuladas com `agora` explícito. O
// serviço de push é simulado por fetch; o teste decifra o corpo como o navegador.
// Isolamento no banco de teste compartilhado: cada execução do arquivo usa um dia sorteado
// entre 2040 e 2067, longe das datas dos outros testes.

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
// 14:00 em Brasília (17:00Z) de um dia sorteado.
const BASE = new Date(Date.UTC(2040, 0, 1, 17, 0, 0) + Math.floor(Math.random() * 10_000) * DIA);
let diaSeguinte = 0;
// Cada teste usa o próprio dia, para os intervalos não se misturarem.
const novaSessaoAs14h = () => new Date(BASE.getTime() + diaSeguinte++ * DIA);
const as = (sessao: Date, minutosAntes: number) => new Date(sessao.getTime() - minutosAntes * MIN);

interface Chamada {
  endpoint: string;
  corpo: Uint8Array;
  ttl: string | null;
}

function servicoDePush(status = 201) {
  const chamadas: Chamada[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({
      endpoint: String(url),
      corpo: new Uint8Array(init!.body as ArrayBuffer),
      ttl: new Headers(init!.headers).get('ttl'),
    });
    return new Response(null, { status });
  }) as typeof fetch;
  return { fn, chamadas };
}

async function profissional() {
  const [u] = await comoAdmin<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em) values ($1, 'Ana Souza', now()) returning id`,
    [emailUnico('push-sessao')],
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

async function sessao(usuarioId: string, pacienteId: string, inicio: Date, status = 'agendada') {
  const [linha] = await comoAdmin<{ id: string }>(
    `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim, status)
     values ($1, $2, $3, $4, $5) returning id`,
    [usuarioId, pacienteId, inicio, new Date(inicio.getTime() + 50 * MIN), status],
  );
  return linha!.id;
}

const avisos = (usuarioId: string) =>
  comoAdmin<{ tipo: string; ref: string }>(
    `select tipo, ref from notificacao_enviada where usuario_id = $1`,
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
  await tarefaPushSessao({
    vapid: () => (vapid === 'com' ? chaves : null),
    fetch: servico,
  }).executar(ctx);
  await Promise.all(segundoPlano);
  return { erros, segundoPlano };
}

describe('sessão próxima: um envio entre 13:45 e 13:50 e nenhum outro (PUSH-02)', () => {
  it('sessão às 14:00: só a execução das 13:45 envia, às 13:40, 13:50, 13:55 e 14:00 não', async () => {
    const { usuarioId, pacienteId } = await profissional();
    const { endpoint } = await ativarPush(usuarioId);
    const inicio = novaSessaoAs14h();
    const id = await sessao(usuarioId, pacienteId, inicio);
    const servico = servicoDePush();
    const porExecucao: Record<string, number> = {};
    for (const [rotulo, antes] of [
      ['13:40', 20],
      ['13:45', 15],
      ['13:50', 10],
      ['13:55', 5],
      ['14:00', 0],
    ] as const) {
      const antesDaExecucao = servico.chamadas.length;
      const { erros } = await rodar(as(inicio, antes), servico.fn);
      expect(erros, rotulo).toEqual([]);
      porExecucao[rotulo] = servico.chamadas.length - antesDaExecucao;
    }
    expect(porExecucao).toEqual({ '13:40': 0, '13:45': 1, '13:50': 0, '13:55': 0, '14:00': 0 });
    expect(servico.chamadas[0]!.endpoint).toBe(endpoint);
    expect(await avisos(usuarioId)).toEqual([{ tipo: 'sessao_proxima', ref: id }]);
  });

  it('se a execução das 13:45 se perdeu, a das 13:50 envia (uma vez)', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const inicio = novaSessaoAs14h();
    await sessao(usuarioId, pacienteId, inicio);
    const servico = servicoDePush();
    await rodar(as(inicio, 10), servico.fn);
    await rodar(as(inicio, 10), servico.fn);
    await rodar(as(inicio, 5), servico.fn);
    expect(servico.chamadas).toHaveLength(1);
  });

  it('execuções sobrepostas não repetem o aviso', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const inicio = novaSessaoAs14h();
    await sessao(usuarioId, pacienteId, inicio);
    const servico = servicoDePush();
    await Promise.all([rodar(as(inicio, 15), servico.fn), rodar(as(inicio, 15), servico.fn)]);
    expect(servico.chamadas).toHaveLength(1);
    expect(await avisos(usuarioId)).toHaveLength(1);
  });

  it('cada dispositivo do profissional recebe o aviso, uma vez', async () => {
    const { usuarioId, pacienteId } = await profissional();
    const um = await ativarPush(usuarioId);
    const dois = await ativarPush(usuarioId);
    const inicio = novaSessaoAs14h();
    await sessao(usuarioId, pacienteId, inicio);
    const servico = servicoDePush();
    await rodar(as(inicio, 15), servico.fn);
    await rodar(as(inicio, 10), servico.fn);
    expect(servico.chamadas.map((c) => c.endpoint).sort()).toEqual(
      [um.endpoint, dois.endpoint].sort(),
    );
  });

  it('só sessões agendadas geram aviso', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const inicio = novaSessaoAs14h();
    for (const status of ['realizada', 'faltou', 'cancelada', 'remarcada'])
      await sessao(usuarioId, pacienteId, inicio, status);
    const servico = servicoDePush();
    await rodar(as(inicio, 15), servico.fn);
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });

  it('o aviso vai só aos dispositivos do dono da sessão', async () => {
    const a = await profissional();
    const b = await profissional();
    const deA = await ativarPush(a.usuarioId);
    await ativarPush(b.usuarioId);
    const inicio = novaSessaoAs14h();
    await sessao(a.usuarioId, a.pacienteId, inicio);
    const servico = servicoDePush();
    await rodar(as(inicio, 15), servico.fn);
    expect(servico.chamadas.map((c) => c.endpoint)).toEqual([deA.endpoint]);
    expect(await avisos(b.usuarioId)).toEqual([]);
  });

  it('sem as chaves VAPID o push está desligado: nada é enviado nem gravado', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const inicio = novaSessaoAs14h();
    await sessao(usuarioId, pacienteId, inicio);
    const servico = servicoDePush();
    await rodar(as(inicio, 15), servico.fn, 'sem');
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });
});

describe('corpo sem nome de paciente nem texto clínico (PUSH-05)', () => {
  it('o navegador recebe só o título, o horário em Brasília e a tela da agenda', async () => {
    const { usuarioId, pacienteId } = await profissional();
    const { nav } = await ativarPush(usuarioId);
    const inicio = novaSessaoAs14h();
    const id = await sessao(usuarioId, pacienteId, inicio);
    await comoAdmin(
      `update sessao_atendimento set link = 'https://meet.exemplo.com/x' where id = $1`,
      [id],
    );
    const servico = servicoDePush();
    await rodar(as(inicio, 15), servico.fn);
    const texto = await decifrarPush(nav, servico.chamadas[0]!.corpo);
    expect(JSON.parse(texto)).toEqual({
      titulo: 'Sessão próxima',
      corpo: 'Sua sessão começa às 14:00.',
      url: '/app/agenda',
    });
    for (const proibido of ['Joana', 'Paciente', 'Sigilosa', 'meet.exemplo.com', id])
      expect(texto, proibido).not.toContain(proibido);
  });

  it('o aviso vence quando a sessão começa (TTL de 15 minutos)', async () => {
    const { usuarioId, pacienteId } = await profissional();
    await ativarPush(usuarioId);
    const inicio = novaSessaoAs14h();
    await sessao(usuarioId, pacienteId, inicio);
    const servico = servicoDePush();
    await rodar(as(inicio, 15), servico.fn);
    expect(servico.chamadas[0]!.ttl).toBe('900');
  });
});

describe('registro no despachante (ADR-010)', () => {
  it('é a primeira tarefa da lista, como no design', () => {
    expect(TAREFAS[0]?.nome).toBe('push_sessao');
  });
});
