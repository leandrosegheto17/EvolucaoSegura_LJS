import { sql } from 'kysely';
import { definirUsuarioDaTransacao } from '../db.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { localizarAssinaturaAsaas, mudarEstadoAssinatura } from '../repositorios/assinatura.ts';
import {
  AssinaturaNaoAchada,
  AvisoWebhook,
  type EventoAsaas,
  type ProcessadorWebhook,
} from './webhook-asaas.ts';

// PLANO-08: webhook de pagamento recebido ou confirmado (PAYMENT_RECEIVED; PAYMENT_CONFIRMED por
// segurança). Decide pelo `event`, nunca pelo `status` do pagamento (spike S3).
// - Acha a assinatura pelo id da assinatura do Asaas ou, sem ela, pelo do cliente (0012). Não
//   achou: AssinaturaNaoAchada (500, o Asaas reenvia; decisão do usuário, 2026-10-27).
// - O payload não traz o próximo vencimento: vem de GET /subscriptions/{id} (nextDueDate).
//   periodo_fim = início do dia seguinte ao vencimento em America/Sao_Paulo (decisão do usuário).
// - Leva a ativa por tarefas.mudar_estado_assinatura: trial, atrasada e free passam a ativa;
//   ativa só adianta periodo_fim, nunca o faz regredir; cancelada não regride para ativa
//   (transição inválida, ignorada e registrada no Sentry, sem dado pessoal).
// - Webhook antes da resposta da criação (edge case): sem os ids gravados, 500; o reenvio, depois
//   de a criação gravar os ids, chega ao mesmo estado final.
// - Audita assinatura.ativa (ator sistema) com os nomes dos campos que mudaram.

export const textoDoPagamento = (evento: EventoAsaas, campo: 'subscription' | 'customer') => {
  const valor = evento.payment?.[campo];
  return typeof valor === 'string' && valor !== '' ? valor : null;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const processarPagamento: ProcessadorWebhook = async ({ trx, evento, asaas, registrar }) => {
  const assinaturaId = textoDoPagamento(evento, 'subscription');
  const atual = await localizarAssinaturaAsaas(
    trx,
    assinaturaId,
    textoDoPagamento(evento, 'customer'),
  );
  if (atual === null || assinaturaId === null) throw new AssinaturaNaoAchada();

  const { proximoVencimento } = await asaas.obterAssinatura(assinaturaId);
  if (!DATA.test(proximoVencimento)) throw new Error('Asaas: nextDueDate fora do formato');
  const { rows } = await sql<{ fim: Date }>`
    select ((${proximoVencimento}::date + 1)::timestamp at time zone 'America/Sao_Paulo') as fim`.execute(
    trx,
  );
  const periodoFim = rows[0]!.fim;

  const { resultado, status_anterior } = await mudarEstadoAssinatura(
    trx,
    atual.usuario_id,
    'ativa',
    { periodoFim },
  );

  let campos: string[] = [];
  if (resultado === 'permitida') {
    campos = ['status', 'periodo_fim'];
    if (status_anterior === 'free') campos.push('plano');
    if (status_anterior === 'atrasada') campos.push('vencimento_atraso');
  } else if (resultado === 'mesmo_estado' && periodoFim > atual.periodo_fim) {
    campos = ['periodo_fim'];
  } else if (resultado === 'transicao_invalida') {
    registrar(
      new AvisoWebhook('transicao_invalida', {
        evento: evento.event,
        de: status_anterior ?? '',
        para: 'ativa',
      }),
    );
  }

  if (campos.length > 0) {
    await definirUsuarioDaTransacao(trx, atual.usuario_id);
    await registrarAuditoria(trx, {
      usuarioId: atual.usuario_id,
      ator: 'sistema',
      acao: 'assinatura.ativa',
      alvoTipo: 'conta',
      alvoId: atual.usuario_id,
      camposAlterados: campos,
    });
  }
  return { usuarioId: atual.usuario_id };
};
