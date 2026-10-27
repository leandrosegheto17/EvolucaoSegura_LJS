import { sql } from 'kysely';
import { definirUsuarioDaTransacao } from '../db.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { localizarAssinaturaAsaas, mudarEstadoAssinatura } from '../repositorios/assinatura.ts';
import { AssinaturaNaoAchada, AvisoWebhook, type ProcessadorWebhook } from './webhook-asaas.ts';
import { textoDoPagamento } from './webhook-pago.ts';

// PLANO-09, D-21: webhook de cobrança vencida (PAYMENT_OVERDUE) muda a assinatura para atrasada e
// grava em vencimento_atraso o início da tolerância de 7 dias (PLANO-10, aplicada pelo cron).
// - PREMISSA: o início da tolerância é o início do dia seguinte ao dueDate da cobrança em
//   America/Sao_Paulo, a mesma regra do periodo_fim (decisão do usuário de 2026-10-27, T130): a
//   cobrança vence ao fim do dia do vencimento.
// - Só ativa vai a atrasada (PLANO-01). Em atrasada, nova cobrança vencida não reinicia a
//   tolerância (mesmo estado, nada muda). Trial, cancelada e free: transição inválida, ignorada e
//   registrada no Sentry (sem dado pessoal); o webhook responde 200.
// - Assinatura não achada ou dueDate fora do formato: erro (500) para o Asaas reenviar.
// - Audita assinatura.atrasada (ator sistema) com os nomes dos campos.

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const processarVencida: ProcessadorWebhook = async ({ trx, evento, registrar }) => {
  const atual = await localizarAssinaturaAsaas(
    trx,
    textoDoPagamento(evento, 'subscription'),
    textoDoPagamento(evento, 'customer'),
  );
  if (atual === null) throw new AssinaturaNaoAchada();
  const vencimento = evento.payment?.dueDate;
  if (typeof vencimento !== 'string' || !DATA.test(vencimento))
    throw new Error('Webhook do Asaas: dueDate fora do formato');

  const { rows } = await sql<{ inicio: Date }>`
    select ((${vencimento}::date + 1)::timestamp at time zone 'America/Sao_Paulo') as inicio`.execute(
    trx,
  );
  const { resultado, status_anterior } = await mudarEstadoAssinatura(
    trx,
    atual.usuario_id,
    'atrasada',
    { vencimentoAtraso: rows[0]!.inicio },
  );

  if (resultado === 'transicao_invalida')
    registrar(
      new AvisoWebhook('transicao_invalida', {
        evento: evento.event,
        de: status_anterior ?? '',
        para: 'atrasada',
      }),
    );
  if (resultado === 'permitida') {
    await definirUsuarioDaTransacao(trx, atual.usuario_id);
    await registrarAuditoria(trx, {
      usuarioId: atual.usuario_id,
      ator: 'sistema',
      acao: 'assinatura.atrasada',
      alvoTipo: 'conta',
      alvoId: atual.usuario_id,
      camposAlterados: ['status', 'vencimento_atraso'],
    });
  }
  return { usuarioId: atual.usuario_id };
};
