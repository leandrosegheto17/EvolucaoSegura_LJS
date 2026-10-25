import { RESPOSTA_ENTRAR, RESPOSTA_LOGIN_RECUSADO, esquemaEntrar } from '@es/contrato/identidade';
import { Hono } from 'hono';
import { gerarCodigo2fa, hmacDoCodigo } from '../codigo-2fa.ts';
import { comTransacao } from '../db.ts';
import { lerCorpo, responderProblema } from '../http.ts';
import type { ClienteEmail, MensagemEmail } from '../integracoes/resend.ts';
import { abrirDesafio2fa, conferirSenha, contaPodeEntrar } from '../repositorios/identidade.ts';

// AUTH-01, AUTH-02, AUTH-03, AUTH-08, CAD-09: POST /api/auth/entrar. A senha é conferida no
// Postgres (bcrypt 12), que calcula o hash também quando o e-mail não existe. Senha errada, e-mail
// inexistente, conta não confirmada ou bloqueada para exclusão recebem o mesmo 401. Com a senha
// certa, abre o desafio 2FA (código de 6 dígitos, só o HMAC no banco, 10 minutos) e envia o código
// por e-mail, sem criar sessão. O envio acontece dentro da transação: se falhar, o desafio é
// desfeito e a resposta é 503 mail_unavailable, sem contar falha de login.

export const VALIDADE_CODIGO_MINUTOS = 10;

export interface DependenciasEntrar {
  email: (env: Cloudflare.Env) => ClienteEmail;
  capturarErro: (erro: unknown) => void;
}

// Sinal interno para desfazer o desafio quando o e-mail não sai.
class EnvioFalhou extends Error {
  constructor(readonly causa: unknown) {
    super('envio do código 2FA falhou');
  }
}

function emailDoCodigo(para: string, codigo: string): MensagemEmail {
  return {
    para,
    assunto: 'Seu código de acesso ao Evolução Segura',
    texto: [
      `Seu código de acesso é ${codigo}.`,
      '',
      `Ele vale por ${VALIDADE_CODIGO_MINUTOS} minutos e só pode ser usado uma vez.`,
      'Se você não tentou entrar, troque sua senha.',
    ].join('\n'),
  };
}

export function rotasEntrar(deps: DependenciasEntrar) {
  return new Hono<{ Bindings: Cloudflare.Env }>().post('/auth/entrar', async (c) => {
    const leitura = await lerCorpo(c, esquemaEntrar);
    if (!leitura.ok) return leitura.resposta;
    const { email, senha } = leitura.dados;

    let resultado: 'recusado' | 'enviado';
    try {
      resultado = await comTransacao(c.env, null, async (trx) => {
        const usuarioId = await conferirSenha(trx, email, senha);
        if (usuarioId === null || !(await contaPodeEntrar(trx, usuarioId))) return 'recusado';
        const codigo = gerarCodigo2fa();
        await abrirDesafio2fa(trx, {
          usuarioId,
          hmac: await hmacDoCodigo(c.env.HMAC_2FA_SEGREDO, usuarioId, codigo),
          validadeMinutos: VALIDADE_CODIGO_MINUTOS,
        });
        try {
          await deps.email(c.env).enviar(emailDoCodigo(email, codigo));
        } catch (erro) {
          throw new EnvioFalhou(erro);
        }
        return 'enviado';
      });
    } catch (erro) {
      if (!(erro instanceof EnvioFalhou)) throw erro;
      deps.capturarErro(erro.causa);
      return responderProblema(c, 'mail_unavailable', 'Não foi possível enviar o código agora');
    }

    if (resultado === 'recusado')
      return c.json(RESPOSTA_LOGIN_RECUSADO, 401, { 'Content-Type': 'application/problem+json' });
    return c.json(RESPOSTA_ENTRAR, 202);
  });
}
