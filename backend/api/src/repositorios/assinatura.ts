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
