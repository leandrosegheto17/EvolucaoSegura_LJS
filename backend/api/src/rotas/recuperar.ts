import { esquemaPedirRecuperacao } from '@es/contrato/identidade';
import { Hono } from 'hono';
import { comTransacao } from '../db.ts';
import { lerCorpo } from '../http.ts';
import type { ClienteEmail, MensagemEmail } from '../integracoes/resend.ts';
import {
  contaPodeEntrar,
  criarTokenEmail,
  invalidarTokens,
  usuarioIdPorEmail,
} from '../repositorios/identidade.ts';
import { gerarToken } from '../tokens.ts';

// AUTH-13: POST /api/auth/recuperar. Responde 202 vazio em todos os casos (conta existente ou
// não, envio com ou sem falha). Se a conta existe, invalida os pedidos de recuperação ainda
// abertos e grava um token novo de 256 bits (só o SHA-256 no banco), válido por 30 minutos e de
// uso único (o consumo fica na rota de redefinição), e envia o link /redefinir?token=...
// PREMISSA: "conta existe" = conta que pode entrar (confirmada e não bloqueada para exclusão); a
// pendente e a bloqueada recebem a mesma resposta, sem e-mail, porque a senha nova não as deixaria
// entrar (AUTH-02, CAD-09).
// PREMISSA: o e-mail sai em segundo plano (waitUntil), depois da resposta, para o tempo de resposta
// não revelar se a conta existe (o caminho sem conta não chama o Resend). Falha vai ao Sentry.

export const VALIDADE_RECUPERACAO_MINUTOS = 30;

export interface DependenciasRecuperar {
  email: (env: Cloudflare.Env) => ClienteEmail;
  capturarErro: (erro: unknown) => void;
  emSegundoPlano: (tarefa: Promise<unknown>) => void;
}

export function emailDeRecuperacao(urlPublica: string, para: string, token: string): MensagemEmail {
  return {
    para,
    assunto: 'Redefinição de senha do Evolução Segura',
    texto: [
      'Recebemos um pedido para redefinir a senha da sua conta.',
      '',
      `Para escolher uma senha nova, abra o link abaixo em até ${VALIDADE_RECUPERACAO_MINUTOS} minutos:`,
      `${urlPublica}/redefinir?token=${token}`,
      '',
      'O link só pode ser usado uma vez. Se você não pediu, ignore este e-mail: sua senha não muda.',
    ].join('\n'),
  };
}

export function rotasRecuperar(deps: DependenciasRecuperar) {
  return new Hono<{ Bindings: Cloudflare.Env }>().post('/auth/recuperar', async (c) => {
    const leitura = await lerCorpo(c, esquemaPedirRecuperacao);
    if (!leitura.ok) return leitura.resposta;
    const { email } = leitura.dados;

    const mensagem = await comTransacao(c.env, null, async (trx) => {
      const usuarioId = await usuarioIdPorEmail(trx, email);
      if (usuarioId === null || !(await contaPodeEntrar(trx, usuarioId))) return null;
      await invalidarTokens(trx, usuarioId, 'recuperacao');
      const { token, hash } = await gerarToken();
      await criarTokenEmail(trx, {
        usuarioId,
        tipo: 'recuperacao',
        hash,
        validadeMinutos: VALIDADE_RECUPERACAO_MINUTOS,
      });
      return emailDeRecuperacao(c.env.URL_PUBLICA, email, token);
    });

    if (mensagem !== null) {
      const envio = (async () => {
        try {
          await deps.email(c.env).enviar(mensagem);
        } catch (erro) {
          deps.capturarErro(erro);
        }
      })();
      deps.emSegundoPlano(envio);
    }
    return c.body(null, 202);
  });
}
