import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { AvisoWebhook } from '../../src/rotas/webhook-asaas.ts';
import { sessaoDeTeste } from '../apoio.ts';
import {
  asaasSimulado,
  auditoriaDe,
  type Estado,
  linhaAssinatura,
  semearAssinatura,
} from './plano-apoio.ts';
import { entregar, eventoAsaas, registroDoEvento } from './webhook-apoio.ts';

// T131 / PLANO-09, D-21: webhook de cobrança vencida (PAYMENT_OVERDUE) muda a assinatura para
// atrasada e grava vencimento_atraso, o início da tolerância de 7 dias (PREMISSA: início do dia
// seguinte ao dueDate em America/Sao_Paulo, a regra do periodo_fim). Transição inválida é
// ignorada (nada muda), registrada, e o webhook responde 200. Audita assinatura.atrasada.

const VENCIMENTO = '2026-10-30';
// Início de 2026-10-31 em America/Sao_Paulo (UTC-3).
const INICIO_TOLERANCIA = new Date('2026-10-31T03:00:00.000Z');

function montar() {
  const asaas = asaasSimulado();
  const avisos: unknown[] = [];
  const app = criarApp({ capturarErro: (e) => avisos.push(e), asaas: () => asaas.cliente });
  return { app, asaas, avisos };
}

async function assinante(status: Estado) {
  const { usuarioId } = await sessaoDeTeste();
  const ids = await semearAssinatura(usuarioId, status, { comAsaas: true });
  return { usuarioId, assinatura: ids.assinatura!, cliente: ids.cliente! };
}

const vencida = (a: { assinatura: string; cliente: string }, dueDate = VENCIMENTO) =>
  eventoAsaas('PAYMENT_OVERDUE', { subscription: a.assinatura, customer: a.cliente, dueDate });

describe('cobrança vencida leva ativa a atrasada (PLANO-09)', () => {
  it('grava vencimento_atraso, mantém periodo_fim e audita', async () => {
    const { app, asaas, avisos } = montar();
    const a = await assinante('ativa');
    const antes = await linhaAssinatura(a.usuarioId);
    const evento = vencida(a);

    const resposta = await entregar(app, evento);

    expect(resposta.status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toMatchObject({
      plano: 'pro',
      status: 'atrasada',
      periodo_fim: antes!.periodo_fim,
      vencimento_atraso: INICIO_TOLERANCIA,
    });
    expect(await auditoriaDe(a.usuarioId)).toEqual([
      {
        ator: 'sistema',
        acao: 'assinatura.atrasada',
        alvo_tipo: 'conta',
        alvo_id: a.usuarioId,
        campos_alterados: ['status', 'vencimento_atraso'],
      },
    ]);
    expect(await registroDoEvento(evento.id)).toMatchObject({ usuario_id: a.usuarioId });
    expect(asaas.chamadas).toEqual([]);
    expect(avisos).toEqual([]);
  });

  it('nova cobrança vencida em atrasada não reinicia a tolerância', async () => {
    const { app, avisos } = montar();
    const a = await assinante('ativa');
    await entregar(app, vencida(a));
    const depoisDaPrimeira = await linhaAssinatura(a.usuarioId);

    const resposta = await entregar(app, vencida(a, '2026-11-30'));

    expect(resposta.status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toEqual(depoisDaPrimeira);
    expect(await auditoriaDe(a.usuarioId)).toHaveLength(1);
    expect(avisos).toEqual([]);
  });
});

describe('transição inválida é ignorada com registro', () => {
  it.each(['trial', 'cancelada', 'free'] as const)('%s não muda e é registrada', async (status) => {
    const { app, avisos } = montar();
    const a = await assinante(status);
    const antes = await linhaAssinatura(a.usuarioId);
    const evento = vencida(a);

    const resposta = await entregar(app, evento);

    expect(resposta.status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toEqual(antes);
    expect(await auditoriaDe(a.usuarioId)).toEqual([]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toBeInstanceOf(AvisoWebhook);
    expect((avisos[0] as AvisoWebhook).detalhes).toEqual({
      evento: 'PAYMENT_OVERDUE',
      de: status,
      para: 'atrasada',
    });
    expect(await registroDoEvento(evento.id)).toMatchObject({ usuario_id: a.usuarioId });
  });
});

describe('erro responde 500 para o Asaas reenviar', () => {
  it('assinatura não achada', async () => {
    const { app } = montar();
    const sufixo = crypto.randomUUID().slice(0, 12);
    const evento = vencida({ assinatura: `sub_${sufixo}`, cliente: `cus_${sufixo}` });
    expect((await entregar(app, evento)).status).toBe(500);
    expect(await registroDoEvento(evento.id)).toBeUndefined();
  });

  it('dueDate fora do formato não muda nada', async () => {
    const { app } = montar();
    const a = await assinante('ativa');
    const antes = await linhaAssinatura(a.usuarioId);
    const evento = vencida(a, '30/10/2026');
    expect((await entregar(app, evento)).status).toBe(500);
    expect(await linhaAssinatura(a.usuarioId)).toEqual(antes);
  });
});
