import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import type { ProcessadorWebhook } from '../../src/rotas/webhook-asaas.ts';
import { sessaoDeTeste } from '../apoio.ts';
import { asaasSimulado } from './plano-apoio.ts';
import { TOKEN_WEBHOOK, entregar, eventoAsaas, registroDoEvento } from './webhook-apoio.ts';

// T129 / PLANO-06, PLANO-07: POST /api/webhooks/asaas.
// - Sem o token configurado (cabeçalho asaas-access-token ausente, diferente, ou token não
//   configurado no Worker) responde 401 sem processar nem gravar nada.
// - Evento novo é gravado antes de processar e marcado como processado; event_id repetido
//   responde 200 sem efeito novo.
// - Erro de processamento responde 500 sem deixar registro (transação única), para o Asaas
//   reenviar; o reenvio é processado.

function appComProcessador(processar: ProcessadorWebhook) {
  const chamadas: string[] = [];
  const app = criarApp({
    capturarErro: () => {},
    asaas: () => asaasSimulado().cliente,
    processadoresWebhook: {
      PAYMENT_RECEIVED: async (ctx) => {
        chamadas.push(ctx.evento.id);
        return processar(ctx);
      },
    },
  });
  return { app, chamadas };
}

describe('autenticação pelo token (PLANO-06)', () => {
  it.each([
    ['sem o cabeçalho', null],
    ['com outro token', 'token-errado-do-webhook-asaas-com-32-ou-mais'],
    ['com o token mais um caractere', `${TOKEN_WEBHOOK}x`],
    ['com o cabeçalho vazio', ''],
  ])('%s responde 401 sem processar', async (_caso, token) => {
    const { app, chamadas } = appComProcessador(async () => ({ usuarioId: null }));
    const evento = eventoAsaas('PAYMENT_RECEIVED');
    const resposta = await entregar(app, evento, { token });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(chamadas).toEqual([]);
    expect(await registroDoEvento(evento.id)).toBeUndefined();
  });

  it('sem ASAAS_WEBHOOK_TOKEN configurado no Worker responde 401 a qualquer token', async () => {
    const { app, chamadas } = appComProcessador(async () => ({ usuarioId: null }));
    const evento = eventoAsaas('PAYMENT_RECEIVED');
    const resposta = await entregar(app, evento, {
      ambiente: { ...env, ASAAS_WEBHOOK_TOKEN: undefined },
    });
    expect(resposta.status).toBe(401);
    expect(chamadas).toEqual([]);
    expect(await registroDoEvento(evento.id)).toBeUndefined();
  });
});

describe('gravar antes de processar e idempotência (PLANO-07)', () => {
  it('evento novo é gravado, processado e marcado com o profissional', async () => {
    const { usuarioId } = await sessaoDeTeste();
    const { app, chamadas } = appComProcessador(async () => ({ usuarioId }));
    const evento = eventoAsaas('PAYMENT_RECEIVED');

    const resposta = await entregar(app, evento);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ status: 'processado' });
    expect(chamadas).toEqual([evento.id]);
    const registro = await registroDoEvento(evento.id);
    expect(registro).toMatchObject({
      tipo: 'PAYMENT_RECEIVED',
      payload: evento,
      usuario_id: usuarioId,
    });
    expect(registro!.processado_em).toBeInstanceOf(Date);
  });

  it('event_id repetido responde 200 sem efeito novo', async () => {
    const { usuarioId } = await sessaoDeTeste();
    const { app, chamadas } = appComProcessador(async () => ({ usuarioId }));
    const evento = eventoAsaas('PAYMENT_RECEIVED');
    await entregar(app, evento);
    const antes = await registroDoEvento(evento.id);

    const resposta = await entregar(app, { ...evento, event: 'PAYMENT_OVERDUE' });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ status: 'repetido' });
    expect(chamadas).toEqual([evento.id]);
    expect(await registroDoEvento(evento.id)).toEqual(antes);
  });

  it('tipo sem processador é gravado e marcado sem profissional', async () => {
    const { app, chamadas } = appComProcessador(async () => ({ usuarioId: null }));
    const evento = eventoAsaas('PAYMENT_CREATED');
    const resposta = await entregar(app, evento);
    expect(resposta.status).toBe(200);
    expect(chamadas).toEqual([]);
    expect(await registroDoEvento(evento.id)).toMatchObject({
      tipo: 'PAYMENT_CREATED',
      usuario_id: null,
    });
  });

  it('corpo sem id ou event responde 422 sem gravar (PREMISSA)', async () => {
    const { app, chamadas } = appComProcessador(async () => ({ usuarioId: null }));
    for (const corpo of ['não é json', { event: 'PAYMENT_RECEIVED' }, { id: 'evt_x&1' }]) {
      const resposta = await entregar(app, corpo);
      expect(resposta.status, JSON.stringify(corpo)).toBe(422);
    }
    expect(chamadas).toEqual([]);
    expect(await registroDoEvento('evt_x&1')).toBeUndefined();
  });
});

describe('erro de processamento responde 500 para o Asaas reenviar', () => {
  it('desfaz o registro e o reenvio é processado', async () => {
    const { usuarioId } = await sessaoDeTeste();
    let falhar = true;
    const { app, chamadas } = appComProcessador(async () => {
      if (falhar) throw new Error('falha simulada no processamento');
      return { usuarioId };
    });
    const evento = eventoAsaas('PAYMENT_RECEIVED');

    const primeira = await entregar(app, evento);
    expect(primeira.status).toBe(500);
    expect(await registroDoEvento(evento.id)).toBeUndefined();

    falhar = false;
    const reenvio = await entregar(app, evento);
    expect(reenvio.status).toBe(200);
    expect(await reenvio.json()).toEqual({ status: 'processado' });
    expect(chamadas).toEqual([evento.id, evento.id]);
    expect(await registroDoEvento(evento.id)).toMatchObject({ usuario_id: usuarioId });
  });
});
