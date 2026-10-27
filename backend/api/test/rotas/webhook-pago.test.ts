import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ErroAsaas } from '../../src/integracoes/asaas.ts';
import { AvisoWebhook } from '../../src/rotas/webhook-asaas.ts';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import {
  asaasSimulado,
  auditoriaDe,
  type Estado,
  linhaAssinatura,
  semearAssinatura,
} from './plano-apoio.ts';
import { entregar, eventoAsaas, registroDoEvento } from './webhook-apoio.ts';

// T130 / PLANO-08: webhook de pagamento recebido (PAYMENT_RECEIVED) ou confirmado
// (PAYMENT_CONFIRMED) muda a assinatura para ativa e define periodo_fim pelo próximo vencimento
// (GET /subscriptions/{id}, nextDueDate), no início do dia seguinte em America/Sao_Paulo
// (decisão do usuário, 2026-10-27).
// - Estado final igual se o webhook chega antes da resposta da criação (edge case da spec): sem os
//   ids gravados responde 500 e o reenvio chega ao mesmo estado.
// - Outros estados não regridem: cancelada não volta a ativa; ativa não recua periodo_fim.
// - Auditoria assinatura.ativa (ator sistema) só com os nomes dos campos.

const PROXIMO_VENCIMENTO = '2026-11-30';
// Início de 2026-12-01 em America/Sao_Paulo (UTC-3).
const PERIODO_FIM = new Date('2026-12-01T03:00:00.000Z');

function montar() {
  const asaas = asaasSimulado({ proximoVencimento: PROXIMO_VENCIMENTO });
  const avisos: unknown[] = [];
  const app = criarApp({ capturarErro: (e) => avisos.push(e), asaas: () => asaas.cliente });
  return { app, asaas, avisos };
}

async function assinante(status: Estado, opcoes: { periodoFim?: string } = {}) {
  const { usuarioId } = await sessaoDeTeste();
  const ids = await semearAssinatura(usuarioId, status, { comAsaas: true, ...opcoes });
  return { usuarioId, assinatura: ids.assinatura!, cliente: ids.cliente! };
}

const pagamento = (
  a: { assinatura: string; cliente: string },
  event: 'PAYMENT_RECEIVED' | 'PAYMENT_CONFIRMED' = 'PAYMENT_RECEIVED',
) => eventoAsaas(event, { subscription: a.assinatura, customer: a.cliente });

describe('pagamento leva a ativa com periodo_fim no próximo vencimento (PLANO-08)', () => {
  it.each(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'] as const)(
    '%s em trial: ativa, periodo_fim no dia seguinte ao nextDueDate e auditoria',
    async (event) => {
      const { app, asaas } = montar();
      const a = await assinante('trial');
      const evento = pagamento(a, event);

      const resposta = await entregar(app, evento);

      expect(resposta.status).toBe(200);
      expect(asaas.chamadas).toEqual([{ operacao: 'obterAssinatura', dados: a.assinatura }]);
      expect(await linhaAssinatura(a.usuarioId)).toMatchObject({
        plano: 'pro',
        status: 'ativa',
        periodo_fim: PERIODO_FIM,
        vencimento_atraso: null,
      });
      expect(await auditoriaDe(a.usuarioId)).toEqual([
        {
          ator: 'sistema',
          acao: 'assinatura.ativa',
          alvo_tipo: 'conta',
          alvo_id: a.usuarioId,
          campos_alterados: ['status', 'periodo_fim'],
        },
      ]);
      expect(await registroDoEvento(evento.id)).toMatchObject({ usuario_id: a.usuarioId });
    },
  );

  it('em atrasada volta a ativa e limpa vencimento_atraso', async () => {
    const { app } = montar();
    const a = await assinante('atrasada');
    expect((await entregar(app, pagamento(a))).status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toMatchObject({
      status: 'ativa',
      periodo_fim: PERIODO_FIM,
      vencimento_atraso: null,
    });
    expect((await auditoriaDe(a.usuarioId))[0]!.campos_alterados).toEqual([
      'status',
      'periodo_fim',
      'vencimento_atraso',
    ]);
  });

  it('em free volta a ativa no plano pro', async () => {
    const { app } = montar();
    const a = await assinante('free');
    expect((await entregar(app, pagamento(a))).status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toMatchObject({
      plano: 'pro',
      status: 'ativa',
      periodo_fim: PERIODO_FIM,
    });
    expect((await auditoriaDe(a.usuarioId))[0]!.campos_alterados).toEqual([
      'status',
      'periodo_fim',
      'plano',
    ]);
  });

  it('renovação de ativa adianta periodo_fim e audita só esse campo', async () => {
    const { app } = montar();
    const a = await assinante('ativa', { periodoFim: '2026-11-01T03:00:00.000Z' });
    expect((await entregar(app, pagamento(a))).status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toMatchObject({
      status: 'ativa',
      periodo_fim: PERIODO_FIM,
    });
    expect(await auditoriaDe(a.usuarioId)).toMatchObject([
      { acao: 'assinatura.ativa', campos_alterados: ['periodo_fim'] },
    ]);
  });
});

describe('outros estados não regridem', () => {
  it('ativa com periodo_fim mais adiante não recua nem audita', async () => {
    const { app } = montar();
    const a = await assinante('ativa', { periodoFim: '2027-01-01T03:00:00.000Z' });
    const antes = await linhaAssinatura(a.usuarioId);
    expect((await entregar(app, pagamento(a))).status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toEqual(antes);
    expect(await auditoriaDe(a.usuarioId)).toEqual([]);
  });

  it('cancelada não volta a ativa: ignorada, registrada e respondida com 200', async () => {
    const { app, avisos } = montar();
    const a = await assinante('cancelada');
    const antes = await linhaAssinatura(a.usuarioId);
    const evento = pagamento(a);

    const resposta = await entregar(app, evento);

    expect(resposta.status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toEqual(antes);
    expect(await auditoriaDe(a.usuarioId)).toEqual([]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toBeInstanceOf(AvisoWebhook);
    expect((avisos[0] as AvisoWebhook).detalhes).toEqual({
      evento: 'PAYMENT_RECEIVED',
      de: 'cancelada',
      para: 'ativa',
    });
    expect(await registroDoEvento(evento.id)).toMatchObject({ usuario_id: a.usuarioId });
  });
});

describe('webhook antes da resposta da criação (edge case)', () => {
  it('sem os ids gravados responde 500; o reenvio chega ao mesmo estado final', async () => {
    const { app } = montar();
    const { usuarioId } = await sessaoDeTeste();
    await semearAssinatura(usuarioId, 'trial');
    const sufixo = crypto.randomUUID().slice(0, 12);
    const ids = { assinatura: `sub_${sufixo}`, cliente: `cus_${sufixo}` };
    const evento = pagamento(ids);

    const antesDaCriacao = await entregar(app, evento);
    expect(antesDaCriacao.status).toBe(500);
    expect(await linhaAssinatura(usuarioId)).toMatchObject({ status: 'trial' });
    expect(await registroDoEvento(evento.id)).toBeUndefined();

    // A criação termina e grava os ids (como a rota de assinar).
    await comoAdmin(
      'update assinatura set asaas_customer_id = $2, asaas_subscription_id = $3 where usuario_id = $1',
      [usuarioId, ids.cliente, ids.assinatura],
    );
    const reenvio = await entregar(app, evento);

    expect(reenvio.status).toBe(200);
    expect(await linhaAssinatura(usuarioId)).toMatchObject({
      plano: 'pro',
      status: 'ativa',
      periodo_fim: PERIODO_FIM,
      vencimento_atraso: null,
    });
    expect(await auditoriaDe(usuarioId)).toHaveLength(1);
  });

  it('Asaas fora ao consultar o vencimento responde 500 sem mudar nada', async () => {
    const { app, asaas } = montar();
    asaas.falharEm('obterAssinatura', new ErroAsaas('tempo_excedido'));
    const a = await assinante('trial');
    const antes = await linhaAssinatura(a.usuarioId);
    const evento = pagamento(a);
    expect((await entregar(app, evento)).status).toBe(500);
    expect(await linhaAssinatura(a.usuarioId)).toEqual(antes);
    expect(await registroDoEvento(evento.id)).toBeUndefined();
  });
});

describe('isolamento', () => {
  it('o pagamento de um profissional não toca a assinatura de outro', async () => {
    const { app } = montar();
    const outro = await assinante('trial');
    const antes = await linhaAssinatura(outro.usuarioId);
    const a = await assinante('trial');
    expect((await entregar(app, pagamento(a))).status).toBe(200);
    expect(await linhaAssinatura(outro.usuarioId)).toEqual(antes);
  });
});
