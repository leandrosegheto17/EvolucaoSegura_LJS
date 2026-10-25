import {
  RESPOSTA_ENTRAR,
  RESPOSTA_LOGIN_RECUSADO,
  esquemaEntrar,
  problema,
} from '@es/contrato/identidade';
import { aposFalhaLogin, bloqueioLogin } from '@es/dominio/identidade/regras-acesso';
import { Hono } from 'hono';
import { gerarCodigo2fa, hmacDoCodigo } from '../codigo-2fa.ts';
import { comTransacao } from '../db.ts';
import { lerCorpo, responderProblema } from '../http.ts';
import type { ClienteEmail, MensagemEmail } from '../integracoes/resend.ts';
import { abrirDesafio2fa, conferirSenha, contaPodeEntrar } from '../repositorios/identidade.ts';
import {
  agoraDoBanco,
  chaveTentativa,
  gravarTentativa,
  travarTentativa,
} from '../repositorios/tentativas.ts';

// AUTH-01, AUTH-02, AUTH-03, AUTH-08, CAD-09: POST /api/auth/entrar. A senha é conferida no
// Postgres (bcrypt 12), que calcula o hash também quando o e-mail não existe. Senha errada, e-mail
// inexistente, conta não confirmada ou bloqueada para exclusão recebem o mesmo 401. Com a senha
// certa, abre o desafio 2FA (código de 6 dígitos, só o HMAC no banco, 10 minutos) e envia o código
// por e-mail, sem criar sessão. O envio acontece dentro da transação: se falhar, o desafio é
// desfeito e a resposta é 503 mail_unavailable, sem contar falha de login.
// AUTH-07: antes de conferir a senha, o e-mail e o IP bloqueados (5 falhas em 15 minutos) recebem
// 429 com Retry-After; essa tentativa não conta. Cada 401 conta uma falha para o e-mail e para o
// IP, pelo relógio do banco. PREMISSA: o login certo não mexe no contador nem no bloqueio.

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

export function emailDoCodigo(para: string, codigo: string): MensagemEmail {
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

    // A Cloudflare preenche CF-Connecting-IP; sem ele (só em teste local), uma chave comum.
    const ip = c.req.header('CF-Connecting-IP') ?? 'sem-ip';
    const chaves = [await chaveTentativa('email', email), await chaveTentativa('ip', ip)];

    let resultado: { tipo: 'bloqueado'; segundos: number } | { tipo: 'recusado' | 'enviado' };
    try {
      resultado = await comTransacao(c.env, null, async (trx) => {
        const agora = await agoraDoBanco(trx);
        const estados = [];
        for (const chave of chaves) estados.push(await travarTentativa(trx, chave));
        const segundos = Math.max(
          0,
          ...estados.map((estado) => {
            const bloqueio = bloqueioLogin(estado, agora);
            return bloqueio.bloqueado ? bloqueio.retryAfterSegundos : 0;
          }),
        );
        if (segundos > 0) return { tipo: 'bloqueado', segundos };

        const usuarioId = await conferirSenha(trx, email, senha);
        if (usuarioId === null || !(await contaPodeEntrar(trx, usuarioId))) {
          for (const [i, chave] of chaves.entries())
            await gravarTentativa(trx, chave, aposFalhaLogin(estados[i]!, agora));
          return { tipo: 'recusado' };
        }
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
        return { tipo: 'enviado' };
      });
    } catch (erro) {
      if (!(erro instanceof EnvioFalhou)) throw erro;
      deps.capturarErro(erro.causa);
      return responderProblema(c, 'mail_unavailable', 'Não foi possível enviar o código agora');
    }

    if (resultado.tipo === 'bloqueado')
      return c.json(problema('muitas_tentativas', 'Muitas tentativas'), 429, {
        'Content-Type': 'application/problem+json',
        'Retry-After': String(resultado.segundos),
      });
    if (resultado.tipo === 'recusado')
      return c.json(RESPOSTA_LOGIN_RECUSADO, 401, { 'Content-Type': 'application/problem+json' });
    return c.json(RESPOSTA_ENTRAR, 202);
  });
}
