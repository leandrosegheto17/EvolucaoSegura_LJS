import { z } from 'zod';
import type { Problema } from './identidade.ts';

// PERF-02, PERF-03: contrato de GET e PUT /api/perfil. Adaptado de shared/src/profile.ts e
// shared/src/specialties.ts do legado, com UMA especialidade por profissional (o legado aceitava
// várias). Corpo estrito: chave desconhecida, no perfil ou na especialidade, é recusada (422).
// Texto é aparado; vazio vira null. No PUT, os textos substituem os atuais (ausente = null),
// enquanto atende_sabado, atende_domingo e especialidade ausentes preservam o valor atual.

export const ESPECIALIDADES = ['psicologia', 'nutricao', 'fisioterapia', 'outra'] as const;
export type Especialidade = (typeof ESPECIALIDADES)[number];

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const esquemaEspecialidade = z
  .strictObject({
    tipo: z.enum(ESPECIALIDADES),
    // Só para "outra", de 1 a 60.
    nome: textoOpcional(60),
    conselho: textoOpcional(40),
    numero_registro: textoOpcional(40),
    regiao: textoOpcional(100),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === 'outra' && v.nome === null)
      ctx.addIssue({ code: 'custom', path: ['nome'], message: 'obrigatório para outra' });
    if (v.tipo !== 'outra' && v.nome !== null)
      ctx.addIssue({ code: 'custom', path: ['nome'], message: 'só para outra' });
  });
export type EspecialidadeDoPerfil = z.output<typeof esquemaEspecialidade>;

export const esquemaPerfilEntrada = z.strictObject({
  nome: z.string().trim().min(1).max(200),
  contato: textoOpcional(200),
  endereco: textoOpcional(300),
  atende_sabado: z.boolean().optional(),
  atende_domingo: z.boolean().optional(),
  especialidade: esquemaEspecialidade.optional(),
  // PERF-06, PERF-07: confirma desligar sábado ou domingo que ainda têm sessões futuras.
  confirmar: z.boolean().optional(),
});
export type PerfilEntrada = z.output<typeof esquemaPerfilEntrada>;

// Resposta de GET e PUT /api/perfil. especialidade nula = perfil incompleto (PERF-01).
export interface Perfil {
  nome: string;
  contato: string | null;
  endereco: string | null;
  atende_sabado: boolean;
  atende_domingo: boolean;
  especialidade: EspecialidadeDoPerfil | null;
}

// GET antes do primeiro salvamento (como no legado) e perfil de outro profissional (ISO-02): o
// mesmo 404.
export const PROBLEMA_PERFIL_NAO_ENCONTRADO: Problema = {
  tipo: 'about:blank',
  titulo: 'Não encontrado',
  status: 404,
  codigo: 'nao_encontrado',
};

// PERF-06: desligar sábado ou domingo com sessões futuras não canceladas nesse dia, sem
// `confirmar: true`. Leva a quantidade de sessões (sábado e domingo somados) e nada é salvo.
export function problemaFimDeSemanaComSessoes(quantidade: number): Problema {
  return {
    tipo: 'about:blank',
    titulo: 'Há sessões nesse dia',
    status: 409,
    codigo: 'WEEKEND_DAY_HAS_SESSIONS',
    quantidade,
  };
}
