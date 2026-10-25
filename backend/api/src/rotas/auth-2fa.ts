import { RESPOSTA_LOGIN_RECUSADO, esquemaVerificar2fa } from '@es/contrato/identidade';
import { aposErro2fa } from '@es/dominio/identidade/regras-acesso';
import { Hono } from 'hono';
import { codigoConfere } from '../codigo-2fa.ts';
import { definirCookieSessao, lerCookieSessao } from '../cookie-sessao.ts';
import { comTransacao, definirUsuarioDaTransacao } from '../db.ts';
import { lerCorpo } from '../http.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import {
  contaPodeEntrar,
  criarSessao,
  encerrarSessaoPorHash,
  marcarDesafioUsado,
  registrarErro2fa,
  travarDesafioAberto,
  usuarioIdPorEmail,
} from '../repositorios/identidade.ts';
import { csrfDaSessao, gerarToken, hashDoToken } from '../tokens.ts';

// AUTH-03, AUTH-04, AUTH-05, AUTH-10, AUD-04: POST /api/auth/2fa/verificar com e-mail e código.
// Numa só transação: acha o desafio aberto mais recente (não usado, não invalidado, dentro dos 10
// minutos), confere o HMAC e:
// - código errado: soma um erro; o 5º invalida o desafio. Responde o mesmo 401 do login;
// - código certo: marca o desafio usado (uso único), encerra a sessão que o navegador apresentou,
//   cria a sessão nova (id de 256 bits, só o SHA-256 no banco), audita auth.login_ok e responde
//   200 com o token CSRF e o cookie __Host-sid.
// Sem conta, sem desafio aberto ou conta que não pode entrar: o mesmo 401.

type Resultado = { ok: false } | { ok: true; sid: string };

export const rotas2fa = new Hono<{ Bindings: Cloudflare.Env }>().post(
  '/auth/2fa/verificar',
  async (c) => {
    const leitura = await lerCorpo(c, esquemaVerificar2fa);
    if (!leitura.ok) return leitura.resposta;
    const { email, codigo } = leitura.dados;
    const cookieAnterior = lerCookieSessao(c);

    const resultado = await comTransacao(c.env, null, async (trx): Promise<Resultado> => {
      const usuarioId = await usuarioIdPorEmail(trx, email);
      if (usuarioId === null) return { ok: false };
      const desafio = await travarDesafioAberto(trx, usuarioId);
      if (desafio === null) return { ok: false };
      if (!(await codigoConfere(c.env.HMAC_2FA_SEGREDO, usuarioId, codigo, desafio.codigoHmac))) {
        await registrarErro2fa(trx, desafio.id, aposErro2fa(desafio.erros));
        return { ok: false };
      }
      if (!(await contaPodeEntrar(trx, usuarioId))) return { ok: false };

      await marcarDesafioUsado(trx, desafio.id);
      if (cookieAnterior) await encerrarSessaoPorHash(trx, await hashDoToken(cookieAnterior));
      const { token: sid, hash } = await gerarToken();
      const sessaoId = await criarSessao(trx, usuarioId, hash);
      await definirUsuarioDaTransacao(trx, usuarioId);
      await registrarAuditoria(trx, {
        usuarioId,
        ator: usuarioId,
        acao: 'auth.login_ok',
        alvoTipo: 'auth',
        alvoId: sessaoId,
        ip: c.req.header('CF-Connecting-IP') ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
      });
      return { ok: true, sid };
    });

    if (!resultado.ok)
      return c.json(RESPOSTA_LOGIN_RECUSADO, 401, { 'Content-Type': 'application/problem+json' });
    definirCookieSessao(c, resultado.sid);
    return c.json({ csrf_token: await csrfDaSessao(resultado.sid) }, 200);
  },
);
