import type { Trx } from '../db.ts';
import type { MensagemEmail } from '../integracoes/resend.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { criarTokenEmail, invalidarTokens } from '../repositorios/identidade.ts';
import { gerarToken } from '../tokens.ts';

// CONTA-02 (T180): pedido de exclusão aceito. Na transação do pedido:
// - invalida os links de exclusão ainda abertos (só o último pedido vale) e grava um token novo
//   de 256 bits (gerarToken), só o SHA-256 no banco, válido por 30 minutos pelo relógio do banco
//   e de uso único (o consumo fica na confirmação, T150);
// - audita conta.exclusao_pedida com alvo conta, sem dado pessoal: nada de e-mail, nome ou senha
//   (o IP truncado e o user-agent resumido são os de todo evento, AUD-01).
// Devolve o e-mail com o link /confirmar-exclusao?token=..., que a rota envia depois do COMMIT.
// PREMISSA: caminho /confirmar-exclusao da tela pública de confirmação (T153).

export const VALIDADE_EXCLUSAO_MINUTOS = 30;

export function emailDeConfirmacaoExclusao(
  urlPublica: string,
  para: string,
  token: string,
): MensagemEmail {
  return {
    para,
    assunto: 'Confirme a exclusão da sua conta no Evolução Segura',
    texto: [
      'Recebemos um pedido para excluir a sua conta no Evolução Segura.',
      '',
      `Para confirmar, abra o link abaixo em até ${VALIDADE_EXCLUSAO_MINUTOS} minutos:`,
      `${urlPublica}/confirmar-exclusao?token=${token}`,
      '',
      'Ao confirmar, a conta é bloqueada na hora e todos os dados são apagados depois de 30 dias.',
      'Até lá, você pode desistir pelo link que enviaremos por e-mail.',
      '',
      'O link só pode ser usado uma vez. Se você não pediu, ignore este e-mail e troque sua senha.',
    ].join('\n'),
  };
}

export async function prepararConfirmacaoExclusao(
  trx: Trx,
  entrada: {
    usuarioId: string;
    email: string;
    urlPublica: string;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<MensagemEmail> {
  const { usuarioId } = entrada;
  await invalidarTokens(trx, usuarioId, 'exclusao');
  const { token, hash } = await gerarToken();
  await criarTokenEmail(trx, {
    usuarioId,
    tipo: 'exclusao',
    hash,
    validadeMinutos: VALIDADE_EXCLUSAO_MINUTOS,
  });
  await registrarAuditoria(trx, {
    usuarioId,
    ator: usuarioId,
    acao: 'conta.exclusao_pedida',
    alvoTipo: 'conta',
    alvoId: usuarioId,
    ip: entrada.ip,
    userAgent: entrada.userAgent,
  });
  return emailDeConfirmacaoExclusao(entrada.urlPublica, entrada.email, token);
}
