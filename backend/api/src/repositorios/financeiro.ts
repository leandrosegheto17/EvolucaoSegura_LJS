import type { Trx } from '../db.ts';

// Leitura do financeiro na transação da requisição (RLS: só o que é do profissional; além do RLS,
// filtra sempre por usuario_id). Adaptado de price.repository.ts e payments.repository.ts do
// legado. O bigint em centavos chega como texto do pg e vira número só aqui (ADR-007).

export const centavos = (texto: string): number => Number(texto);

export const pacienteExiste = async (trx: Trx, usuarioId: string, id: string): Promise<boolean> =>
  (await trx
    .selectFrom('paciente')
    .select('id')
    .where('usuario_id', '=', usuarioId)
    .where('id', '=', id)
    .executeTakeFirst()) !== undefined;

export const sessaoExiste = async (trx: Trx, usuarioId: string, id: string): Promise<boolean> =>
  (await trx
    .selectFrom('sessao_atendimento')
    .select('id')
    .where('usuario_id', '=', usuarioId)
    .where('id', '=', id)
    .executeTakeFirst()) !== undefined;
