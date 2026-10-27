import { PROBLEMA_LIMITE_PLANO } from '@es/contrato/plano';
import {
  type EstadoAssinatura,
  type Plano,
  limitePacientes,
  planoEfetivo,
} from '@es/dominio/plano/assinatura';
import type { Context, MiddlewareHandler } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import type { AmbienteAutenticado } from './autenticada.ts';

// PLANO-02, PLANO-03, PLANO-15 (D-20): plano efetivo e limite do Free, aplicados na API.
// - O plano vem das regras puras da T125 (planoEfetivo) sobre a linha de `assinatura`, com o
//   relógio do banco (now() da transação), como a sessão.
// - PREMISSA: profissional sem linha de assinatura conta como Free (toda conta confirmada nasce
//   em trial, CAD-04; a falta da linha não libera o Pro).
// - Limite do Free: com 5 ou mais pacientes ativos, criar e reativar paciente respondem 403
//   LIMITE_PLANO. Editar e ler seguem livres; inativos não contam, então inativar libera a vaga.
//   Para dois pedidos simultâneos não passarem juntos do limite, a contagem roda depois de um
//   advisory lock da transação por profissional (a app não tem UPDATE em assinatura para um
//   SELECT ... FOR UPDATE).
// SPEC_DEVIATION: o design põe o exigePlano entre o CSRF e a transação; aqui ele roda dentro da
// transação da requisição (depois da lista `autenticada`), para ler a assinatura pelo RLS e para
// a contagem e a gravação do paciente ficarem na mesma transação.

export interface PlanoAtual {
  plano: Plano;
  agora: Date;
  assinatura: {
    status: EstadoAssinatura;
    periodo_fim: Date;
    vencimento_atraso: Date | null;
    asaas_subscription_id: string | null;
  } | null;
}

export async function lerPlano(trx: Trx, usuarioId: string): Promise<PlanoAtual> {
  const { agora } = await sql<{ agora: Date }>`select now() as agora`
    .execute(trx)
    .then((r) => r.rows[0]!);
  const assinatura = await trx
    .selectFrom('assinatura')
    .select(['status', 'periodo_fim', 'vencimento_atraso', 'asaas_subscription_id'])
    .where('usuario_id', '=', usuarioId)
    .executeTakeFirst();
  if (!assinatura) return { plano: 'free', agora, assinatura: null };
  return { plano: planoEfetivo(assinatura, agora), agora, assinatura };
}

// true quando o profissional pode ter mais um paciente ativo.
export async function temVagaDePaciente(trx: Trx, usuarioId: string): Promise<boolean> {
  const { plano } = await lerPlano(trx, usuarioId);
  if (plano === 'pro') return true;
  await sql`select pg_advisory_xact_lock(hashtextextended(${`limite_pacientes:${usuarioId}`}, 0))`.execute(
    trx,
  );
  const { ativos } = await trx
    .selectFrom('paciente')
    .select((eb) => eb.fn.countAll<string>().as('ativos'))
    .where('usuario_id', '=', usuarioId)
    .where('ativo', '=', true)
    .executeTakeFirstOrThrow();
  return limitePacientes(plano, Number(ativos)) === 'ok';
}

export const respostaLimitePlano = (c: Context): Response =>
  c.json(PROBLEMA_LIMITE_PLANO, 403, { 'Content-Type': 'application/problem+json' });

// Criar paciente: depois da lista `autenticada` (precisa da transação).
export const exigeVagaDePaciente: MiddlewareHandler<AmbienteAutenticado> = async (c, next) => {
  if (!(await temVagaDePaciente(c.var.trx, c.var.usuarioId))) return respostaLimitePlano(c);
  await next();
};

// Rota que só o Pro usa: depois da lista `autenticada`. Fora do Pro, 403 LIMITE_PLANO.
export const exigePlano =
  (plano: 'pro'): MiddlewareHandler<AmbienteAutenticado> =>
  async (c, next) => {
    if ((await lerPlano(c.var.trx, c.var.usuarioId)).plano !== plano) return respostaLimitePlano(c);
    await next();
  };
