import type { Paciente } from '@es/contrato/pacientes';
import type { Selectable } from 'kysely';
import type { Banco } from '../db.ts';

// Leitura de pacientes na transação da requisição (RLS: só os do profissional da sessão).
// Adaptado de patients.repository.ts do legado; além do RLS, filtra sempre por usuario_id.

export const COLUNAS_PACIENTE = [
  'id',
  'nome',
  'telefone',
  'email',
  'endereco',
  'ativo',
  'row_version',
  'criado_em',
] as const;

type LinhaPaciente = Pick<Selectable<Banco['paciente']>, (typeof COLUNAS_PACIENTE)[number]>;

export function paraPaciente(linha: LinhaPaciente): Paciente {
  return {
    id: linha.id,
    nome: linha.nome,
    telefone: linha.telefone,
    email: linha.email,
    endereco: linha.endereco,
    ativo: linha.ativo,
    row_version: linha.row_version,
    criado_em: linha.criado_em.toISOString(),
  };
}
