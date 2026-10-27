import { sql } from 'kysely';
import type { Trx } from '../db.ts';

// Assinatura (migration 0004, RLS forçada): a transação precisa ter o usuário definido.
// CAD-04: trial de 14 dias a partir da confirmação (now() da mesma transação).
export async function iniciarTrial(trx: Trx, usuarioId: string, dias: number): Promise<void> {
  await trx
    .insertInto('assinatura')
    .values({
      usuario_id: usuarioId,
      plano: 'pro',
      status: 'trial',
      periodo_fim: sql<Date>`now() + make_interval(days => ${dias})`,
    })
    .execute();
}

// Webhook e cron (sem sessão): funções tarefas.* da migration 0012, que passam pela RLS do
// usuário. Ver os comentários da 0012 para os resultados da mudança de estado.
export type EstadoAssinatura = 'trial' | 'ativa' | 'atrasada' | 'cancelada' | 'free';

export interface AssinaturaLocalizada {
  usuario_id: string;
  status: EstadoAssinatura;
  periodo_fim: Date;
  vencimento_atraso: Date | null;
}

export async function localizarAssinaturaAsaas(
  trx: Trx,
  assinaturaId: string | null,
  clienteId: string | null,
): Promise<AssinaturaLocalizada | null> {
  const { rows } = await sql<AssinaturaLocalizada>`
    select * from tarefas.localizar_assinatura_asaas(${assinaturaId}, ${clienteId})`.execute(trx);
  return rows[0] ?? null;
}

export type ResultadoMudanca = 'permitida' | 'transicao_invalida' | 'mesmo_estado' | 'inexistente';

export async function mudarEstadoAssinatura(
  trx: Trx,
  usuarioId: string,
  status: EstadoAssinatura,
  campos: { periodoFim?: Date | null; vencimentoAtraso?: Date | null } = {},
): Promise<{ resultado: ResultadoMudanca; status_anterior: EstadoAssinatura | null }> {
  const { rows } = await sql<{
    resultado: ResultadoMudanca;
    status_anterior: EstadoAssinatura | null;
  }>`
    select * from tarefas.mudar_estado_assinatura(${usuarioId}::uuid, ${status},
      ${campos.periodoFim ?? null}::timestamptz, ${campos.vencimentoAtraso ?? null}::timestamptz)`.execute(
    trx,
  );
  return rows[0]!;
}
