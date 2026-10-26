import type { Evolucao } from '@es/contrato/clinico';
import { JANELA_SQL, serializarJanela } from '@es/dominio/clinico/janela-edicao';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';

// Repositório da evolução (migration 0009). Tudo na transação do profissional: o RLS só mostra
// e só deixa gravar as linhas dele. A janela do dia vem do relógio do banco (EVO-04).

const EDITAVEL_HOJE = sql<boolean>`${sql.raw(JANELA_SQL.editavelHoje)}`;
const EDITAVEL_ATE = sql<Date>`${sql.raw(JANELA_SQL.editavelAte)}`;

const COLUNAS = [
  'id',
  'paciente_id',
  'sessao_id',
  'texto',
  'row_version',
  'criado_em',
  EDITAVEL_HOJE.as('editavel_hoje'),
  EDITAVEL_ATE.as('editavel_ate'),
] as const;

export interface LinhaEvolucao {
  id: string;
  paciente_id: string;
  sessao_id: string | null;
  texto: string;
  row_version: number;
  criado_em: Date;
  editavel_hoje: boolean;
  editavel_ate: Date;
}

// Evolução por id; `travar` = FOR UPDATE (edição e retificação).
export async function linhaEvolucao(
  trx: Trx,
  id: string,
  travar = false,
): Promise<LinhaEvolucao | undefined> {
  let consulta = trx.selectFrom('evolucao').select(COLUNAS).where('id', '=', id);
  if (travar) consulta = consulta.forUpdate();
  return consulta.executeTakeFirst();
}

// Evoluções do paciente, mais recentes primeiro (como no legado).
export async function evolucoesDoPaciente(
  trx: Trx,
  pacienteId: string,
  limit: number,
  offset: number,
): Promise<LinhaEvolucao[]> {
  return trx
    .selectFrom('evolucao')
    .select(COLUNAS)
    .where('paciente_id', '=', pacienteId)
    .orderBy('criado_em', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();
}

// Monta a resposta: original, retificações em ordem (histórico) e a versão vigente.
export async function paraEvolucoes(trx: Trx, linhas: LinhaEvolucao[]): Promise<Evolucao[]> {
  const ids = linhas.map((l) => l.id);
  const retificacoes =
    ids.length === 0
      ? []
      : await trx
          .selectFrom('evolucao_retificacao')
          .select(['evolucao_id', 'seq', 'texto', 'motivo', 'criado_em'])
          .where('evolucao_id', 'in', ids)
          .orderBy('seq')
          .execute();
  return linhas.map((linha) => {
    const dela = retificacoes.filter((r) => r.evolucao_id === linha.id);
    return {
      id: linha.id,
      paciente_id: linha.paciente_id,
      sessao_id: linha.sessao_id,
      texto: linha.texto,
      ...serializarJanela(linha),
      row_version: linha.row_version,
      criado_em: new Date(linha.criado_em).toISOString(),
      versao_vigente: dela.reduce((maior, r) => Math.max(maior, r.seq), 0),
      retificacoes: dela.map((r) => ({
        seq: r.seq,
        texto: r.texto,
        motivo: r.motivo,
        criado_em: new Date(r.criado_em).toISOString(),
      })),
    };
  });
}

export async function paraEvolucao(trx: Trx, linha: LinhaEvolucao): Promise<Evolucao> {
  const [evolucao] = await paraEvolucoes(trx, [linha]);
  return evolucao!;
}
