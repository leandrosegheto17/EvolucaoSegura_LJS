import { env } from 'cloudflare:workers';
import type { criarApp } from '../../src/app.ts';
import { comoAdmin, ipUnico } from '../apoio.ts';

// Apoio dos testes do webhook do Asaas (T129 a T131): entrega com o token de teste
// (vitest.config.ts), evento no formato do spike S3 com id único e leitura de webhook_evento.

export const TOKEN_WEBHOOK = 'token-de-teste-do-webhook-asaas-com-32-ou-mais';

export function entregar(
  app: ReturnType<typeof criarApp>,
  corpo: unknown,
  opcoes: { token?: string | null; ambiente?: object } = {},
) {
  const token = opcoes.token === undefined ? TOKEN_WEBHOOK : opcoes.token;
  return app.request(
    '/api/webhooks/asaas',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': ipUnico(),
        'User-Agent': 'Asaas_Hmlg/3.0',
        ...(token !== null ? { 'asaas-access-token': token } : {}),
      },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    },
    opcoes.ambiente ?? env,
  );
}

// Evento no formato do spike S3 (dados fictícios), com id único `evt_<hash>&<seq>`.
export function eventoAsaas(
  event: string,
  pagamento: { subscription?: string | null; customer?: string | null; dueDate?: string } = {},
) {
  const hash = crypto.randomUUID().replaceAll('-', '');
  return {
    id: `evt_${hash}&${Math.floor(Math.random() * 1e8)}`,
    event,
    dateCreated: '2026-10-27 11:17:46',
    account: { id: '00000000-0000-4000-8000-000000000000', ownerId: null },
    payment: {
      object: 'payment',
      id: `pay_${hash.slice(0, 16)}`,
      customer: pagamento.customer ?? 'cus_000009700882',
      subscription: pagamento.subscription ?? 'sub_58a47vh52dgm4omd',
      value: 19.9,
      netValue: 19.9,
      billingType: 'PIX',
      status: event === 'PAYMENT_OVERDUE' ? 'OVERDUE' : 'RECEIVED_IN_CASH',
      dueDate: pagamento.dueDate ?? '2026-10-30',
      paymentDate: '2026-10-27',
      pixTransaction: null,
    },
  };
}

export const registroDoEvento = async (eventId: string) =>
  (
    await comoAdmin<{
      tipo: string;
      payload: unknown;
      usuario_id: string | null;
      processado_em: Date | null;
    }>('select tipo, payload, usuario_id, processado_em from webhook_evento where event_id = $1', [
      eventId,
    ])
  )[0];
