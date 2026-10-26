import type { Serie } from '@es/contrato/agenda';
import type { Selectable } from 'kysely';
import type { Banco, Trx } from '../db.ts';
import { COLUNAS_SESSAO, type LinhaSessao } from './sessoes.ts';

// Leitura da série na transação da requisição (RLS e filtro por usuario_id). Adaptado de
// series.repository.ts do legado. Nada é apagado: cancelar só muda o flag e o status (AGE-17).

export const COLUNAS_SERIE = [
  'id',
  'paciente_id',
  'frequencia',
  'ocorrencias',
  'cancelada',
  'row_version',
  'criado_em',
] as const;

export type LinhaSerie = Pick<
  Selectable<Banco['serie_recorrencia']>,
  (typeof COLUNAS_SERIE)[number]
>;

export const paraSerie = (linha: LinhaSerie): Serie => ({
  id: linha.id,
  paciente_id: linha.paciente_id,
  frequencia: linha.frequencia,
  ocorrencias: linha.ocorrencias,
  cancelada: linha.cancelada,
  row_version: linha.row_version,
  criado_em: linha.criado_em.toISOString(),
});

// Todas as ocorrências da série, da mais cedo para a mais tarde.
export const ocorrenciasDaSerie = (
  trx: Trx,
  usuarioId: string,
  serieId: string,
): Promise<LinhaSessao[]> =>
  trx
    .selectFrom('sessao_atendimento')
    .select(COLUNAS_SESSAO)
    .where('usuario_id', '=', usuarioId)
    .where('serie_id', '=', serieId)
    .orderBy('inicio')
    .orderBy('id')
    .execute();
