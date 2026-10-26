import { z } from 'zod';
import type { Problema } from './identidade.ts';
import type { Especialidade } from './perfil.ts';

// EXP-01, EXP-06, EXP-07: contrato da exportação do prontuário de um paciente,
// GET /api/pacientes/:id/prontuario?de=&ate=. Adaptado de record-export.service.ts e
// record-pdf.ts do legado: lá a API devolvia o PDF pronto; aqui devolve o JSON e o app monta o
// PDF no navegador (EXP-02, ADR-008).
// - Período opcional: `de` e `ate` em YYYY-MM-DD, datas de calendário reais, de ≤ até; ausente =
//   sem limite daquele lado. O período filtra só as evoluções, pelo dia do cadastro em
//   America/Sao_Paulo; a anamnese vem sempre (legado). Parâmetro desconhecido também é 400.
// - Anamnese: a versão original, as retificações (com motivo) e a vigente (a de maior seq, ou a
//   original). Cada versão traz só os itens do modelo que existiam na revisão dela, com o rótulo
//   do modelo, campos antes de alertas, cada grupo na ordem do modelo (legado: camposDaVersao).
// - `dia` = data em America/Sao_Paulo do instante `criado_em`.

// Data de calendário real (2026-02-30 não existe), como validDate do legado.
const dataDeCalendario = (texto: string): boolean => {
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
};
const esquemaDia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(dataDeCalendario);

export const esquemaConsultaProntuario = z
  .strictObject({ de: esquemaDia.optional(), ate: esquemaDia.optional() })
  .refine((q) => q.de === undefined || q.ate === undefined || q.de <= q.ate)
  .transform((q) => ({ de: q.de ?? null, ate: q.ate ?? null }));
export type ConsultaProntuario = z.output<typeof esquemaConsultaProntuario>;

export type CampoProntuario =
  | { item_id: string; tipo: 'campo'; rotulo: string; texto: string }
  | { item_id: string; tipo: 'alerta'; rotulo: string; marcado: boolean; obs: string | null };

export interface VersaoAnamneseProntuario {
  modelo_revisao: number;
  campos: CampoProntuario[];
}

export interface RetificacaoAnamneseProntuario extends VersaoAnamneseProntuario {
  seq: number;
  motivo: string;
  criado_em: string;
  dia: string;
}

export interface AnamneseProntuario {
  id: string;
  especialidade: Especialidade;
  data_sessao: string;
  criado_em: string;
  dia: string;
  original: VersaoAnamneseProntuario;
  retificacoes: RetificacaoAnamneseProntuario[];
  // seq da retificação vigente; 0 = a original.
  versao_vigente: number;
  vigente: VersaoAnamneseProntuario;
}

export interface RetificacaoEvolucaoProntuario {
  seq: number;
  texto: string;
  motivo: string;
  criado_em: string;
  dia: string;
}

export interface EvolucaoProntuario {
  id: string;
  sessao_id: string | null;
  criado_em: string;
  dia: string;
  texto: string;
  versao_vigente: number;
  texto_vigente: string;
  retificacoes: RetificacaoEvolucaoProntuario[];
}

// Cabeçalho do PDF (legado: nome, contato e endereço) e registro profissional (EXP-02):
// "conselho número — região", null sem conselho e número.
export interface ProfissionalProntuario {
  nome: string;
  contato: string | null;
  endereco: string | null;
  especialidade: Especialidade | null;
  especialidade_nome: string | null;
  registro: string | null;
}

export interface Prontuario {
  paciente: { id: string; nome: string };
  periodo: ConsultaProntuario;
  // null quando o profissional ainda não tem perfil.
  profissional: ProfissionalProntuario | null;
  anamnese: AnamneseProntuario | null;
  // Em ordem de cadastro.
  evolucoes: EvolucaoProntuario[];
}

const problema = (codigo: string, status: number, titulo: string): Problema => ({
  tipo: 'about:blank',
  titulo,
  status,
  codigo,
});

// EXP-07: paciente de outro profissional, inexistente ou com id malformado (ISO-02).
export const PROBLEMA_PRONTUARIO_NAO_ENCONTRADO = problema('nao_encontrado', 404, 'Não encontrado');
// EXP-07: data fora do formato ou inexistente, de depois de até, ou parâmetro desconhecido.
export const PROBLEMA_PERIODO_INVALIDO = problema('periodo_invalido', 400, 'Período inválido');
