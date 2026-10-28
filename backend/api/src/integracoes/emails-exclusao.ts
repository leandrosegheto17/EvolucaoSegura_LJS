import { DIAS_ATE_PURGA } from '@es/contrato/conta';
import type { Trx } from '../db.ts';
import { mudarEstadoAssinatura } from '../repositorios/assinatura.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { criarTokenEmail, invalidarTokens } from '../repositorios/identidade.ts';
import { gerarToken } from '../tokens.ts';
import { type ClienteAsaas, ErroAsaas } from './asaas.ts';
import type { MensagemEmail } from './resend.ts';

// CONTA-03, CONTA-04 (T181): o que a confirmação da exclusão faz além de bloquear (T150), na
// mesma transação.
// - Assinatura no Asaas: com id de assinatura lá e estado diferente de cancelada (a cancelada já
//   foi cancelada no Asaas pelo PLANO-11), cancela. 404 do Asaas conta como já cancelada (mesma
//   PREMISSA do cron, T137). Outra falha propaga: a rota desfaz tudo e responde 503
//   cobranca_indisponivel (o link continua valendo até vencer). Localmente, ativa vira cancelada
//   (auditada como assinatura.cancelada, igual ao PLANO-11); os demais estados ficam como estão: o
//   trial restante volta com a desistência (CONTA-04).
// - Link de desistência: token novo de 256 bits (só o SHA-256 no banco), de uso único, que vence
//   junto com a purga: DIAS_ATE_PURGA dias contados do now() da transação, o mesmo instante do
//   bloqueio. Os links de desistência ainda abertos são invalidados.
// - E-mail com a data da purga (DD/MM/AAAA em America/Sao_Paulo) e o link /desistir-exclusao,
//   enviado pela rota depois do COMMIT. PREMISSA: caminho /desistir-exclusao (design, publico/).

export const VALIDADE_DESISTENCIA_MINUTOS = DIAS_ATE_PURGA * 24 * 60;

const dataBr = (instante: Date): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instante);

export function mensagemDeExclusaoConfirmada(
  para: string,
  urlPublica: string,
  token: string,
  purgaEm: Date,
): MensagemEmail {
  return {
    para,
    assunto: 'Sua conta no Evolução Segura foi bloqueada para exclusão',
    texto: [
      'A exclusão da sua conta no Evolução Segura foi confirmada.',
      '',
      'A conta já está bloqueada: ninguém consegue entrar nela, e a assinatura do plano Pro, se havia, foi cancelada.',
      `Em ${dataBr(purgaEm)}, todos os dados da conta serão apagados de forma definitiva.`,
      '',
      `Mudou de ideia? Até essa data, abra o link abaixo para desistir da exclusão (válido por ${DIAS_ATE_PURGA} dias):`,
      `${urlPublica}/desistir-exclusao?token=${token}`,
      '',
      'Ao desistir, você volta a entrar com a sua senha e o código por e-mail, no plano Free ou no que restar do teste grátis.',
    ].join('\n'),
  };
}

export async function cancelarAssinaturaDaExclusao(
  trx: Trx,
  entrada: {
    usuarioId: string;
    asaas: () => ClienteAsaas;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const { usuarioId } = entrada;
  const atual = await trx
    .selectFrom('assinatura')
    .select(['status', 'asaas_subscription_id'])
    .where('usuario_id', '=', usuarioId)
    .executeTakeFirst();
  if (!atual) return;

  if (atual.asaas_subscription_id !== null && atual.status !== 'cancelada') {
    try {
      await entrada.asaas().cancelarAssinatura(atual.asaas_subscription_id);
    } catch (erro) {
      const jaNaoExiste = erro instanceof ErroAsaas && erro.tipo === 'falha' && erro.status === 404;
      if (!jaNaoExiste) throw erro;
    }
  }

  if (atual.status === 'ativa') {
    const { resultado } = await mudarEstadoAssinatura(trx, usuarioId, 'cancelada');
    if (resultado === 'permitida')
      await registrarAuditoria(trx, {
        usuarioId,
        ator: usuarioId,
        acao: 'assinatura.cancelada',
        alvoTipo: 'conta',
        alvoId: usuarioId,
        camposAlterados: ['status'],
        ip: entrada.ip,
        userAgent: entrada.userAgent,
      });
  }
}

export async function prepararEmailDeDesistencia(
  trx: Trx,
  entrada: { usuarioId: string; urlPublica: string; purgaEm: Date },
): Promise<MensagemEmail> {
  const { usuarioId } = entrada;
  await invalidarTokens(trx, usuarioId, 'desistencia');
  const { token, hash } = await gerarToken();
  await criarTokenEmail(trx, {
    usuarioId,
    tipo: 'desistencia',
    hash,
    validadeMinutos: VALIDADE_DESISTENCIA_MINUTOS,
  });
  const usuario = await trx
    .selectFrom('usuario')
    .select('email')
    .where('id', '=', usuarioId)
    .executeTakeFirstOrThrow();
  return mensagemDeExclusaoConfirmada(usuario.email, entrada.urlPublica, token, entrada.purgaEm);
}
