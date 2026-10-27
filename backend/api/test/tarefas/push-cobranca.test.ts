import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ContextoTarefa } from '../../src/tarefas/despachar.ts';
import { tarefaPushCobranca } from '../../src/tarefas/push-cobranca.ts';
import { TAREFAS } from '../../src/tarefas/registro.ts';
import { comoAdmin, emailUnico } from '../apoio.ts';
import { decifrarPush, navegadorDePush, vapidDeTeste } from './push-apoio.ts';

// T146 / PUSH-04, PUSH-05: push de cobrança gerada, pagamento confirmado e cobrança vencida, uma
// vez por evento, com corpo sem dado clínico. Os eventos vêm do webhook do Asaas, já gravados e
// processados em webhook_evento (T129 a T131) com o profissional achado; a tarefa do cron os
// transforma em push. Critérios: uma vez por evento; corpo sem dado clínico.
// O serviço de push é simulado por fetch; o teste decifra o corpo como o navegador.
// Isolamento no banco de teste compartilhado: cada teste usa um instante sorteado entre 2040 e
// 2067, longe dos eventos gravados pelos testes do webhook (relógio real).

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const BASE = Date.UTC(2040, 0, 1, 15, 0, 0) + Math.floor(Math.random() * 10_000) * DIA;
let diaSeguinte = 0;
// Cada teste usa o próprio dia (com folga), para as janelas não se misturarem.
const novoAgora = () => new Date(BASE + (diaSeguinte += 3) * DIA);

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
    [emailUnico('push-cobranca')],
  );
  await comoAdmin(
    `insert into paciente (usuario_id, nome) values ($1, 'Joana Paciente Sigilosa')`,
    [u!.id],
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

const idPagamento = () => `pay_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

// Evento do Asaas como o webhook o deixa: gravado, processado e ligado ao profissional.
async function eventoProcessado(
  usuarioId: string | null,
  tipo: string,
  pagamento: string,
  processadoEm: Date | null,
) {
  const payload = {
    id: `evt_${crypto.randomUUID()}`,
    event: tipo,
    payment: {
      id: pagamento,
      subscription: 'sub_123',
      customer: 'cus_123',
      value: 39.9,
      dueDate: '2040-01-10',
      description: 'Evolução Segura Pro',
    },
  };
  await comoAdmin(
    `insert into webhook_evento (event_id, usuario_id, tipo, payload, processado_em)
     values ($1, $2, $3, $4, $5)`,
    [payload.id, usuarioId, tipo, JSON.stringify(payload), processadoEm],
  );
}

const avisos = (usuarioId: string) =>
  comoAdmin<{ tipo: string; ref: string }>(
    `select tipo, ref from notificacao_enviada where usuario_id = $1 order by tipo, ref`,
    [usuarioId],
  );

// Roda a tarefa como o despachante (desde = agora - janela), esperando o waitUntil.
async function rodar(agora: Date, servico: typeof fetch, vapid: 'com' | 'sem' = 'com') {
  const chaves = await vapidDeTeste();
  const segundoPlano: Promise<unknown>[] = [];
  const erros: unknown[] = [];
  const tarefa = tarefaPushCobranca({
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

const antes = (agora: Date, ms: number) => new Date(agora.getTime() - ms);

describe('push de cobrança, uma vez por evento (PUSH-04)', () => {
  it('cobrança gerada, pagamento confirmado e cobrança vencida geram um push cada', async () => {
    const usuarioId = await profissional();
    const { nav } = await ativarPush(usuarioId);
    const agora = novoAgora();
    const [gerada, paga, vencida] = [idPagamento(), idPagamento(), idPagamento()];
    await eventoProcessado(usuarioId, 'PAYMENT_CREATED', gerada, antes(agora, 3 * MIN));
    await eventoProcessado(usuarioId, 'PAYMENT_RECEIVED', paga, antes(agora, 2 * MIN));
    await eventoProcessado(usuarioId, 'PAYMENT_OVERDUE', vencida, antes(agora, MIN));
    const servico = servicoDePush();
    const { erros } = await rodar(agora, servico.fn);
    expect(erros).toEqual([]);
    const recebidos = await Promise.all(
      servico.chamadas.map(async (c) => JSON.parse(await decifrarPush(nav, c.corpo))),
    );
    expect(recebidos.map((m) => m.titulo).sort()).toEqual(
      ['Cobrança vencida', 'Nova cobrança', 'Pagamento confirmado'].sort(),
    );
    expect(await avisos(usuarioId)).toEqual(
      [
        { tipo: 'cobranca_gerada', ref: gerada },
        { tipo: 'cobranca_vencida', ref: vencida },
        { tipo: 'pagamento_confirmado', ref: paga },
      ].sort((x, y) => x.tipo.localeCompare(y.tipo)),
    );
  });

  it('execuções seguintes não repetem o push do mesmo evento', async () => {
    const usuarioId = await profissional();
    await ativarPush(usuarioId);
    const agora = novoAgora();
    await eventoProcessado(usuarioId, 'PAYMENT_CREATED', idPagamento(), antes(agora, MIN));
    const servico = servicoDePush();
    await rodar(agora, servico.fn);
    await rodar(new Date(agora.getTime() + 5 * MIN), servico.fn);
    await rodar(new Date(agora.getTime() + 10 * MIN), servico.fn);
    expect(servico.chamadas).toHaveLength(1);
  });

  it('execuções sobrepostas não repetem o push', async () => {
    const usuarioId = await profissional();
    await ativarPush(usuarioId);
    const agora = novoAgora();
    await eventoProcessado(usuarioId, 'PAYMENT_OVERDUE', idPagamento(), antes(agora, MIN));
    const servico = servicoDePush();
    await Promise.all([rodar(agora, servico.fn), rodar(agora, servico.fn)]);
    expect(servico.chamadas).toHaveLength(1);
    expect(await avisos(usuarioId)).toHaveLength(1);
  });

  it('PAYMENT_RECEIVED e PAYMENT_CONFIRMED do mesmo pagamento geram um push só', async () => {
    const usuarioId = await profissional();
    await ativarPush(usuarioId);
    const agora = novoAgora();
    const pagamento = idPagamento();
    await eventoProcessado(usuarioId, 'PAYMENT_CONFIRMED', pagamento, antes(agora, 2 * MIN));
    await eventoProcessado(usuarioId, 'PAYMENT_RECEIVED', pagamento, antes(agora, MIN));
    const servico = servicoDePush();
    await rodar(agora, servico.fn);
    expect(servico.chamadas).toHaveLength(1);
    expect(await avisos(usuarioId)).toEqual([{ tipo: 'pagamento_confirmado', ref: pagamento }]);
  });

  it('o mesmo tipo de evento em pagamentos diferentes gera um push por pagamento', async () => {
    const usuarioId = await profissional();
    await ativarPush(usuarioId);
    const agora = novoAgora();
    await eventoProcessado(usuarioId, 'PAYMENT_CREATED', idPagamento(), antes(agora, 2 * MIN));
    await eventoProcessado(usuarioId, 'PAYMENT_CREATED', idPagamento(), antes(agora, MIN));
    const servico = servicoDePush();
    await rodar(agora, servico.fn);
    expect(servico.chamadas).toHaveLength(2);
  });

  it('evento ainda não processado entra na execução seguinte à do processamento', async () => {
    const usuarioId = await profissional();
    await ativarPush(usuarioId);
    const agora = novoAgora();
    const pagamento = idPagamento();
    await eventoProcessado(usuarioId, 'PAYMENT_CREATED', pagamento, null);
    const servico = servicoDePush();
    await rodar(agora, servico.fn);
    expect(servico.chamadas).toEqual([]);
    await comoAdmin(
      `update webhook_evento set processado_em = $2 where payload->'payment'->>'id' = $1`,
      [pagamento, new Date(agora.getTime() + MIN)],
    );
    await rodar(new Date(agora.getTime() + 5 * MIN), servico.fn);
    expect(servico.chamadas).toHaveLength(1);
  });

  it('evento sem profissional, de outro tipo ou fora da janela de 24 h não gera push', async () => {
    const usuarioId = await profissional();
    await ativarPush(usuarioId);
    const agora = novoAgora();
    await eventoProcessado(null, 'PAYMENT_CREATED', idPagamento(), antes(agora, MIN));
    for (const tipo of ['PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'SUBSCRIPTION_CREATED'])
      await eventoProcessado(usuarioId, tipo, idPagamento(), antes(agora, MIN));
    await eventoProcessado(usuarioId, 'PAYMENT_CREATED', idPagamento(), antes(agora, DIA + MIN));
    const servico = servicoDePush();
    await rodar(agora, servico.fn);
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(usuarioId)).toEqual([]);
  });

  it('o push vai a cada dispositivo do dono do evento e a mais ninguém', async () => {
    const a = await profissional();
    const b = await profissional();
    const um = await ativarPush(a);
    const dois = await ativarPush(a);
    await ativarPush(b);
    const agora = novoAgora();
    await eventoProcessado(a, 'PAYMENT_CREATED', idPagamento(), antes(agora, MIN));
    const servico = servicoDePush();
    await rodar(agora, servico.fn);
    expect(servico.chamadas.map((c) => c.endpoint).sort()).toEqual(
      [um.endpoint, dois.endpoint].sort(),
    );
    expect(await avisos(b)).toEqual([]);
  });

  it('sem push ativo, nada é gravado; sem as chaves VAPID, nada é enviado nem gravado', async () => {
    const semPush = await profissional();
    const comPush = await profissional();
    await ativarPush(comPush);
    const agora = novoAgora();
    await eventoProcessado(semPush, 'PAYMENT_CREATED', idPagamento(), antes(agora, MIN));
    await eventoProcessado(comPush, 'PAYMENT_CREATED', idPagamento(), antes(agora, MIN));
    const servico = servicoDePush();
    await rodar(agora, servico.fn, 'sem');
    expect(servico.chamadas).toEqual([]);
    expect(await avisos(comPush)).toEqual([]);
    await rodar(agora, servico.fn);
    expect(servico.chamadas).toHaveLength(1);
    expect(await avisos(semPush)).toEqual([]);
  });
});

describe('corpo sem dado clínico (PUSH-05)', () => {
  it('cada evento leva título, texto fixo e a tela Meu plano, sem valor, ids nem paciente', async () => {
    const usuarioId = await profissional();
    const { nav } = await ativarPush(usuarioId);
    const agora = novoAgora();
    const ids = [idPagamento(), idPagamento(), idPagamento()];
    await eventoProcessado(usuarioId, 'PAYMENT_CREATED', ids[0]!, antes(agora, 3 * MIN));
    await eventoProcessado(usuarioId, 'PAYMENT_RECEIVED', ids[1]!, antes(agora, 2 * MIN));
    await eventoProcessado(usuarioId, 'PAYMENT_OVERDUE', ids[2]!, antes(agora, MIN));
    const servico = servicoDePush();
    await rodar(agora, servico.fn);
    const textos = await Promise.all(servico.chamadas.map((c) => decifrarPush(nav, c.corpo)));
    const porTitulo = Object.fromEntries(
      textos.map((t) => {
        const m = JSON.parse(t) as { titulo: string };
        return [m.titulo, m];
      }),
    );
    expect(porTitulo).toEqual({
      'Nova cobrança': {
        titulo: 'Nova cobrança',
        corpo: 'A cobrança mensal do Evolução Segura Pro foi gerada. Pague com Pix em Meu plano.',
        url: '/app/plano',
      },
      'Pagamento confirmado': {
        titulo: 'Pagamento confirmado',
        corpo: 'Recebemos o pagamento do Evolução Segura Pro. Obrigado!',
        url: '/app/plano',
      },
      'Cobrança vencida': {
        titulo: 'Cobrança vencida',
        corpo: 'A cobrança do Evolução Segura Pro venceu. Pague com Pix em Meu plano.',
        url: '/app/plano',
      },
    });
    for (const texto of textos)
      for (const proibido of ['Joana', 'Sigilosa', '39', 'sub_123', 'cus_123', ...ids])
        expect(texto, proibido).not.toContain(proibido);
  });

  it('o push de cobrança vale por 24 horas no serviço de push', async () => {
    const usuarioId = await profissional();
    await ativarPush(usuarioId);
    const agora = novoAgora();
    await eventoProcessado(usuarioId, 'PAYMENT_OVERDUE', idPagamento(), antes(agora, MIN));
    const servico = servicoDePush();
    await rodar(agora, servico.fn);
    expect(servico.chamadas[0]!.ttl).toBe(String(24 * 60 * 60));
  });
});

describe('registro no despachante (ADR-010)', () => {
  it('vem depois da pendência e antes das transições de assinatura, como no design', () => {
    const nomes = TAREFAS.map((t) => t.nome);
    expect(nomes.slice(0, 3)).toEqual(['push_sessao', 'push_pendente', 'push_cobranca']);
    expect(nomes.indexOf('push_cobranca')).toBeLessThan(nomes.indexOf('assinaturas'));
  });
});
