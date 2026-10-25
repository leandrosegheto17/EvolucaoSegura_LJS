import type { MiddlewareHandler } from 'hono';
import { type Trx, comTransacao } from '../db.ts';
import type { VariaveisSessao } from './sessao.ts';

// ISO-01: última etapa antes do handler numa rota autenticada. Abre a transação da requisição
// com o profissional da sessão (BEGIN + set_config('app.usuario_id', ..., true)) e entrega a
// transação ao handler em c.var.trx; tudo o que o handler grava, inclusive a auditoria, entra
// nela. Se o handler lançar, o Hono já respondeu pelo onError (500 e Sentry) e marcou c.error:
// aqui a transação é desfeita, sem reportar o erro de novo.

export interface VariaveisTransacao extends VariaveisSessao {
  trx: Trx;
}

class Desfazer extends Error {}

export const transacao: MiddlewareHandler<{
  Bindings: Cloudflare.Env;
  Variables: VariaveisTransacao;
}> = async (c, next) => {
  try {
    await comTransacao(c.env, c.var.usuarioId, async (trx) => {
      c.set('trx', trx);
      await next();
      if (c.error) throw new Desfazer();
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
  }
};
