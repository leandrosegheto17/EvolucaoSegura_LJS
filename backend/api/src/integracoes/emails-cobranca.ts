import type { ClienteEmail, MensagemEmail } from './resend.ts';
import { criarClienteResend } from './resend.ts';

// PLANO-13 (T138): e-mails transacionais de cobrança, um por evento do webhook do Asaas: cobrança
// gerada (PAYMENT_CREATED), pagamento confirmado (PAYMENT_RECEIVED/CONFIRMED que levou a ativa ou
// adiantou periodo_fim) e cobrança vencida (PAYMENT_OVERDUE que levou ativa a atrasada).
// - Texto puro em português (o Resend recebe só `text`, D-27). Sem dado clínico, sem nome do
//   paciente, sem ids do Asaas e sem o endereço do destinatário no corpo; o link leva ao Meu plano.
// - Não repete: o webhook dedupe pelo event_id (PLANO-07) e só pede e-mail quando o processador
//   muda o estado (ou adianta periodo_fim); o envio sai depois do COMMIT, em segundo plano, e a
//   falha vai ao Sentry sem desfazer nada (padrão do e-mail de recuperação).
// - Datas vêm como AAAA-MM-DD do Asaas e saem como DD/MM/AAAA. Fim da tolerância (D-21): a cobrança
//   vence ao fim do dia do vencimento, a tolerância começa no dia seguinte e dura 7 dias, então o
//   último dia para pagar é vencimento + 7.

export type EmailCobranca =
  | { tipo: 'cobranca_gerada'; vencimento: string | null; valorCentavos: number | null }
  | { tipo: 'pagamento_confirmado'; proximoVencimento: string }
  | { tipo: 'cobranca_vencida'; vencimento: string };

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
export const ehData = (valor: unknown): valor is string =>
  typeof valor === 'string' && DATA.test(valor);

const dataBr = (iso: string): string => {
  const [, ano, mes, dia] = DATA.exec(iso)!;
  return `${dia}/${mes}/${ano}`;
};

const somarDias = (iso: string, dias: number): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

const reais = (centavos: number): string =>
  `R$ ${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, '0')}`;

const DIAS_TOLERANCIA = 7;

export function mensagemDeCobranca(
  email: EmailCobranca,
  para: string,
  urlPublica: string,
): MensagemEmail {
  const link = `${urlPublica}/app/plano`;
  switch (email.tipo) {
    case 'cobranca_gerada':
      return {
        para,
        assunto: 'Nova cobrança do Evolução Segura Pro',
        texto: [
          'A cobrança mensal do Evolução Segura Pro foi gerada.',
          '',
          ...(email.valorCentavos !== null ? [`Valor: ${reais(email.valorCentavos)}`] : []),
          ...(email.vencimento !== null ? [`Vencimento: ${dataBr(email.vencimento)}`] : []),
          '',
          'Para pagar com Pix, abra Meu plano:',
          link,
        ].join('\n'),
      };
    case 'pagamento_confirmado':
      return {
        para,
        assunto: 'Pagamento confirmado no Evolução Segura',
        texto: [
          'Recebemos o pagamento do Evolução Segura Pro. Obrigado!',
          '',
          `Seu plano Pro está ativo. Próxima cobrança: ${dataBr(email.proximoVencimento)}.`,
          '',
          'Detalhes em Meu plano:',
          link,
        ].join('\n'),
      };
    case 'cobranca_vencida':
      return {
        para,
        assunto: 'Cobrança vencida do Evolução Segura Pro',
        texto: [
          `A cobrança do Evolução Segura Pro com vencimento em ${dataBr(email.vencimento)} não foi paga.`,
          '',
          `Você pode pagar com Pix até ${dataBr(somarDias(email.vencimento, DIAS_TOLERANCIA))} pelo Meu plano. Depois disso, a conta passa para o plano Free, sem perder nenhum dado.`,
          '',
          link,
        ].join('\n'),
      };
  }
}

// PREMISSA: sem RESEND_API_KEY ou MAIL_FROM (ambiente local e testes), os e-mails de cobrança
// ficam desligados (null) em vez de virar erro no Sentry a cada webhook. Em produção as duas são
// obrigatórias para o 2FA (sem elas o login já responde 503 e alerta).
export const emailCobrancaPadrao = (env: Cloudflare.Env): ClienteEmail | null =>
  env.RESEND_API_KEY && env.MAIL_FROM
    ? criarClienteResend({ apiKey: env.RESEND_API_KEY, remetente: env.MAIL_FROM })
    : null;
