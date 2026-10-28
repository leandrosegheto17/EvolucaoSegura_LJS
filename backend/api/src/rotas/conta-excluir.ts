import {
  RESPOSTA_PEDIR_EXCLUSAO,
  type RequisitoExclusao,
  esquemaPedirExclusao,
  problemaRequisitosExclusao,
} from '@es/contrato/conta';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { type Trx, comTransacao } from '../db.ts';
import { lerCorpo } from '../http.ts';
import { csrf } from '../middleware/csrf.ts';
import { type VariaveisSessao, sessao } from '../middleware/sessao.ts';
import { conferirSenha } from '../repositorios/identidade.ts';

// CONTA-01: POST /api/conta/excluir, pedido de exclusão da conta. Rota autenticada (sessão e
// CSRF); a transação é aberta aqui, e não pelo middleware, para o e-mail sair depois do COMMIT.
// Requisitos, todos conferidos a cada pedido (a senha sempre passa pelo bcrypt do banco):
// - exportacao: a exportação completa foi servida até a última página (evento
//   exportacao.concluida da T173) nas últimas 24 horas, pelo relógio do banco; o limite exato de
//   24 horas atrás já não vale;
// - declaracao_guarda: veio true;
// - senha: confere com a da conta (conferir_senha, AUTH-12).
// Faltando qualquer um: 422 requisitos_exclusao com a lista do que falta, sem gravar nada.

export const JANELA_EXPORTACAO_HORAS = 24;

async function exportouNasUltimas24h(trx: Trx, usuarioId: string): Promise<boolean> {
  const linha = await trx
    .selectFrom('audit_log')
    .select('id')
    .where('usuario_id', '=', usuarioId)
    .where('acao', '=', 'exportacao.concluida')
    .where('criado_em', '>', sql<Date>`now() - make_interval(hours => ${JANELA_EXPORTACAO_HORAS})`)
    .limit(1)
    .executeTakeFirst();
  return linha !== undefined;
}

async function emailDaConta(trx: Trx, usuarioId: string): Promise<string> {
  const linha = await trx
    .selectFrom('usuario')
    .select('email')
    .where('id', '=', usuarioId)
    .executeTakeFirstOrThrow();
  return linha.email;
}

type Ambiente = { Bindings: Cloudflare.Env; Variables: VariaveisSessao };

export const rotasContaExcluir = () =>
  new Hono<Ambiente>().post('/conta/excluir', sessao, csrf, async (c) => {
    const leitura = await lerCorpo(c, esquemaPedirExclusao);
    if (!leitura.ok) return leitura.resposta;
    const { senha, declaracao_guarda: declaracao } = leitura.dados;
    const { usuarioId } = c.var;

    const faltam = await comTransacao(c.env, usuarioId, async (trx) => {
      const email = await emailDaConta(trx, usuarioId);
      const faltando: RequisitoExclusao[] = [];
      if (!(await exportouNasUltimas24h(trx, usuarioId))) faltando.push('exportacao');
      if (declaracao !== true) faltando.push('declaracao_guarda');
      if ((await conferirSenha(trx, email, senha ?? '')) !== usuarioId) faltando.push('senha');
      return faltando;
    });

    if (faltam.length > 0)
      return c.json(problemaRequisitosExclusao(faltam), 422, {
        'Content-Type': 'application/problem+json',
      });
    return c.json(RESPOSTA_PEDIR_EXCLUSAO, 202);
  });
