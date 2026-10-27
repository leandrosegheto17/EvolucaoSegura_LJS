import { ehData } from '../integracoes/emails-cobranca.ts';
import { localizarAssinaturaAsaas } from '../repositorios/assinatura.ts';
import { AssinaturaNaoAchada, type ProcessadorWebhook } from './webhook-asaas.ts';
import { textoDoPagamento } from './webhook-pago.ts';

// PLANO-13 (T138): webhook de cobrança gerada (PAYMENT_CREATED). Não muda estado: só acha o
// profissional e pede o e-mail de cobrança gerada, com o vencimento (dueDate) e o valor (reais no
// payload, centavos aqui, ADR-007) quando legíveis. O reenvio do mesmo evento é barrado pelo
// event_id (PLANO-07), então o e-mail sai uma vez por evento.
// - Assinatura não achada: AssinaturaNaoAchada (500, o Asaas reenvia), a mesma regra dos outros
//   eventos (decisão do usuário, 2026-10-27); cobre a primeira cobrança, que pode chegar antes de a
//   criação gravar os ids.

const centavos = (valor: unknown): number | null =>
  typeof valor === 'number' && Number.isFinite(valor) && valor >= 0
    ? Math.round(valor * 100)
    : null;

export const processarCobrancaGerada: ProcessadorWebhook = async ({ trx, evento }) => {
  const atual = await localizarAssinaturaAsaas(
    trx,
    textoDoPagamento(evento, 'subscription'),
    textoDoPagamento(evento, 'customer'),
  );
  if (atual === null) throw new AssinaturaNaoAchada();
  const vencimento = evento.payment?.dueDate;
  const valor = (evento.payment as { value?: unknown } | undefined)?.value;
  return {
    usuarioId: atual.usuario_id,
    email: {
      tipo: 'cobranca_gerada',
      vencimento: ehData(vencimento) ? vencimento : null,
      valorCentavos: centavos(valor),
    },
  };
};
