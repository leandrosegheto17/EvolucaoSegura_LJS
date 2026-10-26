import { z } from 'zod';
import type { Problema } from './identidade.ts';

// PAC-01, PAC-02, PAC-05: contrato das rotas de pacientes e TCLE. Adaptado de
// backend/src/patients/domain/{patient,consent}.ts do legado, sem a ciência de IA (fora do
// escopo) e sem a edição dos dados do paciente (a spec não pede). Corpo estrito: campo extra é
// recusado (422). Texto é aparado; vazio vira null.

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

// x@y sem espaços (legado: /^[^\s@]+@[^\s@]+$/).
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+$/;

export const esquemaPacienteEntrada = z.strictObject({
  nome: z.string().trim().min(1).max(200),
  telefone: textoOpcional(40),
  email: textoOpcional(254).refine((v) => v === null || FORMATO_EMAIL.test(v), 'email inválido'),
  endereco: textoOpcional(500),
});
export type PacienteEntrada = z.output<typeof esquemaPacienteEntrada>;

export interface Paciente {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  ativo: boolean;
  row_version: number;
  criado_em: string;
}

// Listagem: os parâmetros chegam como texto na query string. Parâmetro desconhecido é ignorado,
// como no legado. A busca é aparada e cortada em 200 caracteres (legado); vazia = sem busca.
const inteiroDaQuery = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int());

export const LIMITE_PADRAO_PACIENTES = 50;
export const LIMITE_MAXIMO_PACIENTES = 100;

export const esquemaListagemPacientes = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => v?.trim().slice(0, 200) || null),
  ativo: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? null : v === 'true')),
  limit: inteiroDaQuery
    .pipe(z.number().min(1).max(LIMITE_MAXIMO_PACIENTES))
    .optional()
    .transform((v) => v ?? LIMITE_PADRAO_PACIENTES),
  offset: inteiroDaQuery
    .pipe(z.number().min(0))
    .optional()
    .transform((v) => v ?? 0),
});
export type ListagemPacientes = z.output<typeof esquemaListagemPacientes>;

export interface PaginaPacientes {
  items: Paciente[];
  limit: number;
  offset: number;
}

// Data de calendário real (2026-02-30 não existe).
const dataDeCalendario = (texto: string): boolean => {
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
};

export const esquemaTcleEntrada = z.strictObject({
  finalidade: z.string().trim().min(1).max(500),
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(dataDeCalendario, 'data inválida'),
  versao: z.string().trim().min(1).max(50),
});
export type TcleEntrada = z.output<typeof esquemaTcleEntrada>;

export interface Tcle {
  id: string;
  finalidade: string;
  data: string;
  versao: string;
  registrado_em: string;
}

// Paciente inexistente, de outro profissional ou com id malformado (ISO-02): o mesmo 404 de
// qualquer recurso não encontrado.
export const PROBLEMA_PACIENTE_NAO_ENCONTRADO: Problema = {
  tipo: 'about:blank',
  titulo: 'Não encontrado',
  status: 404,
  codigo: 'nao_encontrado',
};

// PAC-02: `ativo`, `limit` ou `offset` inválidos na listagem.
export const PROBLEMA_CONSULTA_INVALIDA: Problema = {
  tipo: 'about:blank',
  titulo: 'Consulta inválida',
  status: 400,
  codigo: 'consulta_invalida',
};
