import { esquemaReenviar2fa } from '@es/contrato/identidade';
import { podeReenviarCodigo } from '@es/dominio/identidade/regras-acesso';
import { Hono } from 'hono';
import { gerarCodigo2fa, hmacDoCodigo } from '../codigo-2fa.ts';
import { comTransacao } from '../db.ts';
import { lerCorpo } from '../http.ts';
import {
  abrirDesafio2fa,
  contaPodeEntrar,
  travarDesafioAberto,
  usuarioIdPorEmail,
} from '../repositorios/identidade.ts';
import { agoraDoBanco } from '../repositorios/tentativas.ts';
import { VALIDADE_CODIGO_MINUTOS, emailDoCodigo, type DependenciasEntrar } from './auth-entrar.ts';

// AUTH-06: POST /api/auth/2fa/reenviar. Responde sempre o mesmo 202 e só envia um código novo se o
// último envio (criação do desafio aberto) tiver mais de 60 segundos, com as duas datas tiradas do
// banco. O reenvio cria um desafio novo, e o anterior deixa de valer. PREMISSA: só há reenvio de
// um desafio ainda aberto (senha conferida, código não usado, não vencido, não invalidado por 5
// erros); sem ele nada sai, para o reenvio não virar um jeito de mandar código sem a senha.
// Falha do e-mail desfaz o desafio novo (o anterior segue valendo) e vai ao Sentry.

export const RESPOSTA_REENVIO = { status: 'aceito' } as const;

// Sinal interno para desfazer o desafio novo quando o e-mail não sai.
class EnvioFalhou extends Error {
  constructor(readonly causa: unknown) {
    super('reenvio do código 2FA falhou');
  }
}

export function rotasReenviar2fa(deps: DependenciasEntrar) {
  return new Hono<{ Bindings: Cloudflare.Env }>().post('/auth/2fa/reenviar', async (c) => {
    const leitura = await lerCorpo(c, esquemaReenviar2fa);
    if (!leitura.ok) return leitura.resposta;
    const { email } = leitura.dados;

    try {
      await comTransacao(c.env, null, async (trx) => {
        const usuarioId = await usuarioIdPorEmail(trx, email);
        if (usuarioId === null || !(await contaPodeEntrar(trx, usuarioId))) return;
        const desafio = await travarDesafioAberto(trx, usuarioId);
        if (desafio === null) return;
        if (!podeReenviarCodigo(desafio.criadoEm, await agoraDoBanco(trx))) return;
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
      });
    } catch (erro) {
      if (!(erro instanceof EnvioFalhou)) throw erro;
      deps.capturarErro(erro.causa);
    }
    return c.json(RESPOSTA_REENVIO, 202);
  });
}
