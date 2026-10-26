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

// Ajuste de preço da sessão e preço do paciente da sessão, em centavos (null = não definido).
export async function precosDaSessao(
  trx: Trx,
  usuarioId: string,
  sessaoId: string,
): Promise<{ precoSessao: number | null; precoPaciente: number | null }> {
  const linha = await trx
    .selectFrom('sessao_atendimento as s')
    .leftJoin('preco_sessao as ps', (j) =>
      j.onRef('ps.sessao_id', '=', 's.id').onRef('ps.usuario_id', '=', 's.usuario_id'),
    )
    .leftJoin('preco_paciente as pp', (j) =>
      j.onRef('pp.paciente_id', '=', 's.paciente_id').onRef('pp.usuario_id', '=', 's.usuario_id'),
    )
    .select(['ps.valor_centavos as sessao', 'pp.valor_centavos as paciente'])
    .where('s.usuario_id', '=', usuarioId)
    .where('s.id', '=', sessaoId)
    .executeTakeFirst();
  return {
    precoSessao:
      linha?.sessao === null || linha?.sessao === undefined ? null : centavos(linha.sessao),
    precoPaciente:
      linha?.paciente === null || linha?.paciente === undefined ? null : centavos(linha.paciente),
  };
}
