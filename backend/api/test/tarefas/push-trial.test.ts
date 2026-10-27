import { chaveTrialTerminando } from '@es/dominio/push/janelas';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ContextoTarefa } from '../../src/tarefas/despachar.ts';
import { tarefaPushTrial } from '../../src/tarefas/push-trial.ts';
import { TAREFAS } from '../../src/tarefas/registro.ts';
import { comoAdmin, emailUnico } from '../apoio.ts';
import { decifrarPush, navegadorDePush, vapidDeTeste } from './push-apoio.ts';

// T178 / PUSH-04, PUSH-05: quando o trial termina em 3 dias, o profissional recebe um push, uma
// vez por evento (o trial que termina em periodo_fim), com corpo sem dado clínico. A janela vem
// do domínio (T141): de periodo_fim - 72 h (inclusive) até periodo_fim (exclusivo).
// O cron roda de 5 em 5 minutos; aqui as execuções são simuladas com `agora` explícito. O serviço
// de push é simulado por fetch; o teste decifra o corpo como o navegador.
// Isolamento no banco de teste compartilhado: cada teste usa um instante sorteado entre 2040 e
// 2067, longe dos trials dos outros testes (2026) e da tarefa de assinaturas (1999).

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const BASE = Date.UTC(2040, 0, 1, 15, 0, 0) + Math.floor(Math.random() * 10_000) * DIA;
let deslocamento = 0;
// Fim de trial só deste teste (com folga de 10 dias entre os testes), com microssegundos, como
// o now() + intervalo do Postgres o deixa.
const novoFim = () => new Date(BASE + (deslocamento += 10) * DIA + 123);
const antes = (fim: Date, ms: number) => new Date(fim.getTime() - ms);

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

async function profissional(fim: Date, status = 'trial', microssegundos = 456) {
  const [u] = await comoAdmin<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em) values ($1, 'Ana Souza', now()) returning id`,
    [emailUnico('push-trial')],
  );
  await comoAdmin(
    `insert into paciente (usuario_id, nome) values ($1, 'Joana Paciente Sigilosa')`,
    [u!.id],
  );
  // periodo_fim com microssegundos (o JS não os representa): por padrão, fim + 0,456 ms.
  await comoAdmin(
    `insert into assinatura (usuario_id, plano, status, periodo_fim)
     values ($1, $2, $3, $4::timestamptz + make_interval(secs => $5::integer / 1e6))`,
    [u!.id, status === 'free' ? 'free' : 'pro', status, fim, microssegundos],
  );
  return u!.id;
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
  const tarefa = tarefaPushTrial({
    vapid: () => (vapid === 'com' ? chaves : null),
    fetch: servico,
  });
  const ctx: ContextoTarefa = {
    agora,
    desde: tarefa.janelaMs === null ? null : new Date(agora.getTime() - tarefa.janelaMs),
    limite: 10,
    env,
    emSegundoPlano: (p) => segundoPlano.push(p),
    capturarErro: (e) => erros.push(e),
  };
  await tarefa.executar(ctx);
  await Promise.all(segundoPlano);
  return { erros };
}

describe('fim de trial em 3 dias, uma vez por evento (PUSH-04)', () => {
  it('só a primeira execução dentro dos 3 dias envia; as seguintes não repetem', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    const { endpoint } = await ativarPush(usuarioId);
    const servico = servicoDePush();
    const porExecucao: Record<string, number> = {};
    for (const [rotulo, ms] of [
      ['3 dias e 5 min antes', 3 * DIA + 5 * MIN],
      ['3 dias antes', 3 * DIA - 5 * MIN],
      ['3 dias menos 10 min', 3 * DIA - 10 * MIN],
      ['1 dia antes', DIA],
      ['1 min antes', MIN],
    ] as const) {
      const antesDaExecucao = servico.chamadas.length;
      const { erros } = await rodar(antes(fim, ms), servico.fn);
      expect(erros, rotulo).toEqual([]);
      porExecucao[rotulo] = servico.chamadas.length - antesDaExecucao;
    }
    expect(porExecucao).toEqual({
      '3 dias e 5 min antes': 0,
      '3 dias antes': 1,
      '3 dias menos 10 min': 0,
      '1 dia antes': 0,
      '1 min antes': 0,
    });
    expect(servico.chamadas[0]!.endpoint).toBe(endpoint);
  });

  it('o limite de 3 dias é inclusive; 1 ms antes não envia', async () => {
    const fim = novoFim();
    // Fim sem microssegundos, para cair exatamente no limite.
    const usuarioId = await profissional(fim, 'trial', 0);
    await ativarPush(usuarioId);
    const servico = servicoDePush();
    await rodar(antes(fim, 3 * DIA + 1), servico.fn);
    expect(servico.chamadas).toEqual([]);
    await rodar(antes(fim, 3 * DIA), servico.fn);
    expect(servico.chamadas).toHaveLength(1);
  });

  it('a chave do evento é o fim do trial no formato do domínio', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    await ativarPush(usuarioId);
    await rodar(antes(fim, DIA), servicoDePush().fn);
    expect(await avisos(usuarioId)).toEqual([chaveTrialTerminando(fim)]);
  });

  it('trial já vencido ou que não termina em 3 dias não gera push', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    await ativarPush(usuarioId);
    const servico = servicoDePush();
    await rodar(antes(fim, 4 * DIA), servico.fn);
    await rodar(new Date(fim.getTime() + MIN), servico.fn);
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });

  it('só assinatura em trial: ativa, atrasada, cancelada e free não recebem', async () => {
    const fim = novoFim();
    const ids = [];
    for (const status of ['ativa', 'atrasada', 'cancelada', 'free']) {
      const id = await profissional(fim, status);
      await ativarPush(id);
      ids.push(id);
    }
    const servico = servicoDePush();
    await rodar(antes(fim, 2 * DIA), servico.fn);
    expect(servico.chamadas).toEqual([]);
    for (const id of ids) expect(await avisos(id)).toEqual([]);
  });

  it('push ativado com o trial já perto do fim: envia uma vez, com os dias que faltam', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    const servico = servicoDePush();
    await rodar(antes(fim, 2 * DIA), servico.fn);
    expect(await avisos(usuarioId)).toEqual([]);
    const { nav } = await ativarPush(usuarioId);
    await rodar(antes(fim, 20 * HORA), servico.fn);
    await rodar(antes(fim, 10 * HORA), servico.fn);
    expect(servico.chamadas).toHaveLength(1);
    const mensagem = JSON.parse(await decifrarPush(nav, servico.chamadas[0]!.corpo));
    expect(mensagem.corpo).toBe(
      'Seu período de teste termina em 1 dia. Assine em Meu plano para continuar no Pro.',
    );
  });

  it('execuções sobrepostas não repetem o push', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    await ativarPush(usuarioId);
    const servico = servicoDePush();
    await Promise.all([rodar(antes(fim, DIA), servico.fn), rodar(antes(fim, DIA), servico.fn)]);
    expect(servico.chamadas).toHaveLength(1);
    expect(await avisos(usuarioId)).toHaveLength(1);
  });

  it('cada dispositivo do profissional recebe o push; outro profissional não', async () => {
    const fim = novoFim();
    const a = await profissional(fim);
    const b = await profissional(new Date(fim.getTime() + 5 * DIA));
    const um = await ativarPush(a);
    const dois = await ativarPush(a);
    await ativarPush(b);
    const servico = servicoDePush();
    await rodar(antes(fim, DIA), servico.fn);
    expect(servico.chamadas.map((c) => c.endpoint).sort()).toEqual(
      [um.endpoint, dois.endpoint].sort(),
    );
    expect(await avisos(b)).toEqual([]);
  });

  it('sem as chaves VAPID o push está desligado: nada é enviado nem gravado', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    await ativarPush(usuarioId);
    const servico = servicoDePush();
    await rodar(antes(fim, DIA), servico.fn, 'sem');
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });
});

describe('corpo sem dado clínico (PUSH-05)', () => {
  it('o navegador recebe título, os dias que faltam e a tela Meu plano, nada do paciente', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    const { nav } = await ativarPush(usuarioId);
    const servico = servicoDePush();
    await rodar(antes(fim, 3 * DIA - MIN), servico.fn);
    const texto = await decifrarPush(nav, servico.chamadas[0]!.corpo);
    expect(JSON.parse(texto)).toEqual({
      titulo: 'Seu teste está acabando',
      corpo: 'Seu período de teste termina em 3 dias. Assine em Meu plano para continuar no Pro.',
      url: '/app/plano',
    });
    for (const proibido of ['Joana', 'Sigilosa', 'Ana', usuarioId])
      expect(texto, proibido).not.toContain(proibido);
  });

  it('com 2 dias e algumas horas, o corpo diz 3 dias (arredonda para cima)', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    const { nav } = await ativarPush(usuarioId);
    const servico = servicoDePush();
    await rodar(antes(fim, 2 * DIA + 5 * HORA), servico.fn);
    const mensagem = JSON.parse(await decifrarPush(nav, servico.chamadas[0]!.corpo));
    expect(mensagem.corpo).toContain('termina em 3 dias');
  });

  it('o push vale por 24 horas no serviço de push', async () => {
    const fim = novoFim();
    const usuarioId = await profissional(fim);
    await ativarPush(usuarioId);
    const servico = servicoDePush();
    await rodar(antes(fim, DIA), servico.fn);
    expect(servico.chamadas[0]!.ttl).toBe(String(24 * 60 * 60));
  });
});

describe('registro no despachante (ADR-010)', () => {
  it('vem depois do push de cobrança e antes das transições de assinatura', () => {
    const nomes = TAREFAS.map((t) => t.nome);
    expect(nomes.slice(0, 4)).toEqual([
      'push_sessao',
      'push_pendente',
      'push_cobranca',
      'push_trial',
    ]);
    expect(nomes.indexOf('push_trial')).toBeLessThan(nomes.indexOf('assinaturas'));
    expect(TAREFAS.find((t) => t.nome === 'push_trial')?.janelaMs).toBeNull();
  });
});
