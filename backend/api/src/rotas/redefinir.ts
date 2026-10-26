import { type MotivoSenha, esquemaConfirmarRecuperacao } from '@es/contrato/identidade';
import { avaliarSenha } from '@es/dominio/identidade/politica-senha';
import { Hono } from 'hono';
import { comTransacao } from '../db.ts';
import { lerCorpo, responderProblema } from '../http.ts';
import {
  consumirToken,
  definirSenha,
  encerrarSessoesDoUsuario,
} from '../repositorios/identidade.ts';
import { hashDoToken } from '../tokens.ts';

// AUTH-14, AUTH-15: POST /api/auth/recuperar/confirmar com o token do link e a senha nova. Numa
// só transação, nesta ordem:
// 1. consome o token de recuperação (uso único, dentro da validade, não invalidado); se não serve,
//    400 link_invalido, antes de olhar a senha (AUTH-15);
// 2. avalia a política de senha (AUTH-11); fora dela, 422 com o motivo e a transação é desfeita,
//    então o link continua valendo para uma nova tentativa (PREMISSA: "uso único" = uma
//    redefinição concluída);
// 3. troca o hash (bcrypt 12 no Postgres) e encerra todas as sessões do profissional com UPDATE.
// Responde 204 sem abrir sessão: o profissional entra de novo com senha e 2FA.

// Sinais internos para desfazer a transação.
class LinkInvalido extends Error {}
class SenhaForaDaPolitica extends Error {
  constructor(readonly motivo: MotivoSenha) {
    super('senha fora da política');
  }
}

export const rotasRedefinir = new Hono<{ Bindings: Cloudflare.Env }>().post(
  '/auth/recuperar/confirmar',
  async (c) => {
    const leitura = await lerCorpo(c, esquemaConfirmarRecuperacao);
    if (!leitura.ok) return leitura.resposta;
    const { token, nova_senha: novaSenha } = leitura.dados;
    const hash = await hashDoToken(token);

    try {
      await comTransacao(c.env, null, async (trx) => {
        const usuarioId = await consumirToken(trx, hash, 'recuperacao');
        if (usuarioId === null) throw new LinkInvalido();
        const motivo = avaliarSenha(novaSenha);
        if (motivo !== null) throw new SenhaForaDaPolitica(motivo);
        await definirSenha(trx, usuarioId, novaSenha);
        await encerrarSessoesDoUsuario(trx, usuarioId);
      });
    } catch (erro) {
      if (erro instanceof LinkInvalido)
        return responderProblema(c, 'link_invalido', 'Link inválido');
      if (erro instanceof SenhaForaDaPolitica)
        return responderProblema(c, 'senha_fora_da_politica', 'Senha fora da política', {
          motivo: erro.motivo,
        });
      throw erro;
    }
    return c.body(null, 204);
  },
);
