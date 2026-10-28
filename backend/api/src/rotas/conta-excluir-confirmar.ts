import {
  DIAS_ATE_PURGA,
  type RespostaConfirmarExclusao,
  esquemaTokenExclusao,
} from '@es/contrato/conta';
import { PROBLEMA_COBRANCA_INDISPONIVEL } from '@es/contrato/plano';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { type Trx, comTransacao, definirUsuarioDaTransacao } from '../db.ts';
import { lerCorpo, responderProblema } from '../http.ts';
import type { ClienteAsaas } from '../integracoes/asaas.ts';
import {
  cancelarAssinaturaDaExclusao,
  prepararEmailDeDesistencia,
} from '../integracoes/emails-exclusao.ts';
import type { ClienteEmail, MensagemEmail } from '../integracoes/resend.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { consumirToken, encerrarSessoesDoUsuario } from '../repositorios/identidade.ts';
import { hashDoToken } from '../tokens.ts';

// CONTA-03 (T150): POST /api/conta/excluir/confirmar com o token do link do e-mail. Rota pública
// (o link pode ser aberto noutro aparelho, sem sessão), como a confirmação do cadastro. Numa só
// transação:
// 1. consome o token de exclusão (uso único, dentro dos 30 minutos, não invalidado); se não serve,
//    400 link_invalido;
// 2. bloqueia a conta (bloqueado_exclusao_em = now()); conta já bloqueada também é link_invalido,
//    e a transação é desfeita (o token não é gasto);
// 3. encerra todas as sessões abertas do profissional (UPDATE de data) e audita
//    conta.exclusao_confirmada só com o nome do campo.
// Responde 200 com a data da purga: DIAS_ATE_PURGA dias depois do bloqueio. Daí em diante o login
// e o 2FA recusam a conta com o 401 de sempre (contaPodeEntrar, AUTH-02).
// T181 (CONTA-03, CONTA-04), integracoes/emails-exclusao.ts: na mesma transação, cancela a
// assinatura no Asaas (Asaas fora: 503 cobranca_indisponivel, tudo desfeito e o link segue
// valendo; o erro vai ao Sentry) e grava o link de desistência; depois do COMMIT envia o e-mail
// com a data da purga e esse link.

// Sinal interno para desfazer a transação quando o link não serve.
class LinkInvalido extends Error {}
class CobrancaIndisponivel extends Error {
  constructor(readonly causa: unknown) {
    super('cobrança indisponível');
  }
}

async function bloquear(trx: Trx, usuarioId: string): Promise<Date | null> {
  const linha = await trx
    .updateTable('usuario')
    .set({ bloqueado_exclusao_em: sql<Date>`now()` })
    .where('id', '=', usuarioId)
    .where('bloqueado_exclusao_em', 'is', null)
    .returning('bloqueado_exclusao_em')
    .executeTakeFirst();
  return linha?.bloqueado_exclusao_em ?? null;
}

export interface OpcoesContaExcluirConfirmar {
  asaas: (env: Cloudflare.Env) => ClienteAsaas;
  // null = e-mail desligado (sem Resend configurado), como os de cobrança.
  email: (env: Cloudflare.Env) => ClienteEmail | null;
  capturarErro: (erro: unknown) => void;
  emSegundoPlano: (tarefa: Promise<unknown>) => void;
}

export const rotasContaExcluirConfirmar = ({
  asaas,
  email,
  capturarErro,
  emSegundoPlano,
}: OpcoesContaExcluirConfirmar) =>
  new Hono<{ Bindings: Cloudflare.Env }>().post('/conta/excluir/confirmar', async (c) => {
    const leitura = await lerCorpo(c, esquemaTokenExclusao);
    if (!leitura.ok) return leitura.resposta;
    const hash = await hashDoToken(leitura.dados.token);
    const ip = c.req.header('CF-Connecting-IP') ?? null;
    const userAgent = c.req.header('User-Agent') ?? null;

    let confirmado: { purgaEm: Date; mensagem: MensagemEmail };
    try {
      confirmado = await comTransacao(c.env, null, async (trx) => {
        const usuarioId = await consumirToken(trx, hash, 'exclusao');
        if (usuarioId === null) throw new LinkInvalido();
        const bloqueio = await bloquear(trx, usuarioId);
        if (bloqueio === null) throw new LinkInvalido();
        await encerrarSessoesDoUsuario(trx, usuarioId);
        // A partir daqui o RLS vale para este profissional (assinatura e audit_log).
        await definirUsuarioDaTransacao(trx, usuarioId);
        // T181: cancela no Asaas; falha que não seja 404 desfaz tudo (503 abaixo).
        try {
          await cancelarAssinaturaDaExclusao(trx, {
            usuarioId,
            asaas: () => asaas(c.env),
            ip,
            userAgent,
          });
        } catch (erro) {
          throw new CobrancaIndisponivel(erro);
        }
        await registrarAuditoria(trx, {
          usuarioId,
          ator: usuarioId,
          acao: 'conta.exclusao_confirmada',
          alvoTipo: 'conta',
          alvoId: usuarioId,
          camposAlterados: ['bloqueado_exclusao_em'],
          ip,
          userAgent,
        });
        const purgaEm = new Date(bloqueio.getTime() + DIAS_ATE_PURGA * 24 * 60 * 60_000);
        const mensagem = await prepararEmailDeDesistencia(trx, {
          usuarioId,
          urlPublica: c.env.URL_PUBLICA,
          purgaEm,
        });
        return { purgaEm, mensagem };
      });
    } catch (erro) {
      if (erro instanceof LinkInvalido)
        return responderProblema(c, 'link_invalido', 'Link inválido');
      if (erro instanceof CobrancaIndisponivel) {
        capturarErro(erro.causa);
        return c.json(PROBLEMA_COBRANCA_INDISPONIVEL, 503, {
          'Content-Type': 'application/problem+json',
        });
      }
      throw erro;
    }

    // T181: e-mail com a data da purga e o link de desistência, depois do COMMIT, em segundo
    // plano; a falha vai ao Sentry e não muda a resposta.
    const envio = (async () => {
      try {
        const cliente = email(c.env);
        if (cliente !== null) await cliente.enviar(confirmado.mensagem);
      } catch (erro) {
        capturarErro(erro);
      }
    })();
    emSegundoPlano(envio);

    const resposta: RespostaConfirmarExclusao = {
      status: 'bloqueada',
      purga_em: confirmado.purgaEm.toISOString(),
    };
    return c.json(resposta, 200);
  });
