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
import type { ClienteEmail, MensagemEmail } from '../integracoes/resend.ts';
import { conferirSenha } from '../repositorios/identidade.ts';
import { prepararConfirmacaoExclusao } from './conta-excluir-email.ts';

// CONTA-01: POST /api/conta/excluir, pedido de exclusão da conta. Rota autenticada (sessão e
// CSRF); a transação é aberta aqui, e não pelo middleware, para o e-mail sair depois do COMMIT.
// Requisitos, todos conferidos a cada pedido (a senha sempre passa pelo bcrypt do banco):
// - exportacao: a exportação completa foi servida até a última página (evento
//   exportacao.concluida da T173) nas últimas 24 horas, pelo relógio do banco; o limite exato de
//   24 horas atrás já não vale;
// - declaracao_guarda: veio true;
// - senha: confere com a da conta (conferir_senha, AUTH-12).
// Faltando qualquer um: 422 requisitos_exclusao com a lista do que falta, sem gravar nada.
// Com todos: token, auditoria e e-mail de confirmação (conta-excluir-email.ts, T180); 202.

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

export interface OpcoesContaExcluir {
  // null = e-mail desligado (sem Resend configurado), como os de cobrança.
  email: (env: Cloudflare.Env) => ClienteEmail | null;
  capturarErro: (erro: unknown) => void;
  emSegundoPlano: (tarefa: Promise<unknown>) => void;
}

type Resultado =
  { ok: false; faltando: RequisitoExclusao[] } | { ok: true; mensagem: MensagemEmail };

export const rotasContaExcluir = ({ email, capturarErro, emSegundoPlano }: OpcoesContaExcluir) =>
  new Hono<Ambiente>().post('/conta/excluir', sessao, csrf, async (c) => {
    const leitura = await lerCorpo(c, esquemaPedirExclusao);
    if (!leitura.ok) return leitura.resposta;
    const { senha, declaracao_guarda: declaracao } = leitura.dados;
    const { usuarioId } = c.var;

    const resultado = await comTransacao(c.env, usuarioId, async (trx): Promise<Resultado> => {
      const emailConta = await emailDaConta(trx, usuarioId);
      const faltando: RequisitoExclusao[] = [];
      if (!(await exportouNasUltimas24h(trx, usuarioId))) faltando.push('exportacao');
      if (declaracao !== true) faltando.push('declaracao_guarda');
      if ((await conferirSenha(trx, emailConta, senha ?? '')) !== usuarioId) faltando.push('senha');
      if (faltando.length > 0) return { ok: false, faltando };
      // CONTA-02 (T180): token, auditoria e o e-mail com o link de confirmação.
      const mensagem = await prepararConfirmacaoExclusao(trx, {
        usuarioId,
        email: emailConta,
        urlPublica: c.env.URL_PUBLICA,
        ip: c.req.header('CF-Connecting-IP') ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
      });
      return { ok: true, mensagem };
    });

    if (!resultado.ok)
      return c.json(problemaRequisitosExclusao(resultado.faltando), 422, {
        'Content-Type': 'application/problem+json',
      });

    // Depois do COMMIT, em segundo plano; a falha vai ao Sentry e não muda a resposta.
    const envio = (async () => {
      try {
        const cliente = email(c.env);
        if (cliente !== null) await cliente.enviar(resultado.mensagem);
      } catch (erro) {
        capturarErro(erro);
      }
    })();
    emSegundoPlano(envio);
    return c.json(RESPOSTA_PEDIR_EXCLUSAO, 202);
  });
