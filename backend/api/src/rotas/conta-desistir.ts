import { DIAS_ATE_PURGA, esquemaTokenExclusao } from '@es/contrato/conta';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { type Trx, comTransacao, definirUsuarioDaTransacao } from '../db.ts';
import { lerCorpo, responderProblema } from '../http.ts';
import { desvincularAssinaturaAsaas, mudarEstadoAssinatura } from '../repositorios/assinatura.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { consumirToken } from '../repositorios/identidade.ts';
import { hashDoToken } from '../tokens.ts';

// CONTA-04 (T151): POST /api/conta/desistir com o token do link de desistência (T181). Rota
// pública: a conta bloqueada não tem sessão. Numa só transação:
// 1. consome o token de desistência (uso único, não invalidado, dentro da validade); se não
//    serve, 400 link_invalido. Depois da purga (T152) as linhas do profissional, inclusive os
//    tokens, já não existem: o link cai aqui também;
// 2. desbloqueia só a conta bloqueada há menos de DIAS_ATE_PURGA dias (o token vence junto, mas a
//    data do bloqueio é a referência da purga); fora disso, link_invalido e nada muda;
// 3. plano: trial com periodo_fim no futuro continua trial (o trial restante); qualquer outro
//    estado vai para free (ativa passa antes por cancelada, a única saída de ativa na máquina do
//    PLANO-01; só acontece se um pagamento chegou depois do cancelamento no Asaas), e o id da
//    assinatura do Asaas, já cancelada lá na confirmação, é limpo. Cada mudança é auditada como
//    assinatura.<estado> com os nomes dos campos;
// 4. audita conta.exclusao_desistida.
// Responde 200; a sessão não é aberta: o profissional entra com senha e 2FA (AUTH-02 volta a
// aceitar a conta, que deixou de estar bloqueada).

class LinkInvalido extends Error {}

async function desbloquear(trx: Trx, usuarioId: string): Promise<boolean> {
  const linha = await trx
    .updateTable('usuario')
    .set({ bloqueado_exclusao_em: null })
    .where('id', '=', usuarioId)
    .where('bloqueado_exclusao_em', 'is not', null)
    .where(
      'bloqueado_exclusao_em',
      '>',
      sql<Date>`now() - make_interval(days => ${DIAS_ATE_PURGA})`,
    )
    .returning('id')
    .executeTakeFirst();
  return linha !== undefined;
}

interface Origem {
  ip: string | null;
  userAgent: string | null;
}

async function voltarAoPlano(trx: Trx, usuarioId: string, origem: Origem): Promise<void> {
  const atual = await trx
    .selectFrom('assinatura')
    .select([
      'status',
      'asaas_subscription_id',
      'vencimento_atraso',
      sql<boolean>`periodo_fim > now()`.as('vigente'),
    ])
    .where('usuario_id', '=', usuarioId)
    .executeTakeFirst();
  if (!atual || atual.status === 'free') return;
  if (atual.status === 'trial' && atual.vigente) return;

  const auditar = (acao: 'assinatura.cancelada' | 'assinatura.free', campos: string[]) =>
    registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao,
      alvoTipo: 'conta',
      alvoId: usuarioId,
      camposAlterados: campos,
      ...origem,
    });

  if (atual.status === 'ativa') {
    const { resultado } = await mudarEstadoAssinatura(trx, usuarioId, 'cancelada');
    if (resultado !== 'permitida') return;
    await auditar('assinatura.cancelada', ['status']);
  }
  const { resultado } = await mudarEstadoAssinatura(trx, usuarioId, 'free');
  if (resultado !== 'permitida') return;
  const campos = ['status', 'plano'];
  if (atual.vencimento_atraso !== null) campos.push('vencimento_atraso');
  if (
    atual.asaas_subscription_id !== null &&
    (await desvincularAssinaturaAsaas(trx, usuarioId)) === 'desvinculada'
  )
    campos.push('asaas_subscription_id');
  await auditar('assinatura.free', campos);
}

export const rotasContaDesistir = () =>
  new Hono<{ Bindings: Cloudflare.Env }>().post('/conta/desistir', async (c) => {
    const leitura = await lerCorpo(c, esquemaTokenExclusao);
    if (!leitura.ok) return leitura.resposta;
    const hash = await hashDoToken(leitura.dados.token);
    const origem: Origem = {
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    };

    try {
      await comTransacao(c.env, null, async (trx) => {
        const usuarioId = await consumirToken(trx, hash, 'desistencia');
        if (usuarioId === null) throw new LinkInvalido();
        if (!(await desbloquear(trx, usuarioId))) throw new LinkInvalido();
        // A partir daqui o RLS vale para este profissional (assinatura e audit_log).
        await definirUsuarioDaTransacao(trx, usuarioId);
        await voltarAoPlano(trx, usuarioId, origem);
        await registrarAuditoria(trx, {
          usuarioId,
          ator: usuarioId,
          acao: 'conta.exclusao_desistida',
          alvoTipo: 'conta',
          alvoId: usuarioId,
          camposAlterados: ['bloqueado_exclusao_em'],
          ...origem,
        });
      });
    } catch (erro) {
      if (erro instanceof LinkInvalido)
        return responderProblema(c, 'link_invalido', 'Link inválido');
      throw erro;
    }
    return c.json({ status: 'desbloqueada' } as const, 200);
  });
