import { z } from 'zod';
import type { Problema } from './identidade.ts';

// EVO-01, EVO-04, EVO-05, RAS-01, RAS-02, RAS-03: contrato da evolução, da retificação, do
// rascunho e do modelo de texto. Adaptado de evolution.domain.ts, draft.ts e templates.domain.ts
// do legado. Corpo estrito: campo extra é recusado (422 `validacao`, só com os nomes dos campos,
// nunca o texto, que é dado clínico).
// Decisões do usuário (2026-10-26): listagem das evoluções do paciente paginada (limit até 100);
// rascunho com If-Match e 412 PRECONDITION_FAILED; modelo de texto com `tipo` obrigatório (só
// `evolucao`), PUT que edita e arquiva ou desarquiva, e nome duplicado = 409 TEMPLATE_NAME_EXISTS.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esquemaId = z.string().regex(UUID, 'id inválido');
const esquemaVersao = z.number().int().positive();

// EVO-01, EVO-05: texto não vazio depois de aparar, até 100.000. O texto é guardado como veio.
export const TEXTO_EVOLUCAO_MAXIMO = 100_000;
const esquemaTexto = z
  .string()
  .max(TEXTO_EVOLUCAO_MAXIMO)
  .refine((s) => s.trim() !== '', 'texto obrigatório');

// POST /api/evolucoes. sessao_id ausente ou null = evolução sem sessão.
export const esquemaEvolucaoEntrada = z.strictObject({
  paciente_id: esquemaId,
  sessao_id: esquemaId.nullish().transform((v) => v ?? null),
  texto: esquemaTexto,
});
export type EvolucaoEntrada = z.output<typeof esquemaEvolucaoEntrada>;

// PUT /api/evolucoes/:id (EVO-04): novo texto com o row_version lido.
export const esquemaEvolucaoGravacao = z.strictObject({
  texto: esquemaTexto,
  row_version: esquemaVersao,
});
export type EvolucaoGravacao = z.output<typeof esquemaEvolucaoGravacao>;

// POST /api/evolucoes/:id/retificacoes (EVO-05): texto novo e motivo, até 100.000 cada.
export const esquemaEvolucaoRetificacao = z.strictObject({
  texto: esquemaTexto,
  motivo: esquemaTexto,
});
export type EvolucaoRetificacao = z.output<typeof esquemaEvolucaoRetificacao>;

// GET /api/pacientes/:id/evolucoes: limit de 1 a 100 (padrão 50) e offset, como no legado.
const inteiroDaQuery = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int());
export const esquemaListagemEvolucoes = z.object({
  limit: inteiroDaQuery
    .pipe(z.number().min(1).max(100))
    .optional()
    .transform((v) => v ?? 50),
  offset: inteiroDaQuery
    .pipe(z.number().min(0))
    .optional()
    .transform((v) => v ?? 0),
});
export type ListagemEvolucoes = z.output<typeof esquemaListagemEvolucoes>;

export interface RetificacaoEvolucao {
  seq: number;
  texto: string;
  motivo: string;
  criado_em: string;
}

// Resposta da evolução. `texto` é o da versão original; a vigente é a retificação de maior seq
// (`versao_vigente`, 0 = a original). `estado` e `editavel_ate` vêm do relógio do banco
// (America/Sao_Paulo).
export interface Evolucao {
  id: string;
  paciente_id: string;
  sessao_id: string | null;
  texto: string;
  estado: 'editavel_hoje' | 'registrada';
  editavel_ate: string;
  row_version: number;
  criado_em: string;
  versao_vigente: number;
  retificacoes: RetificacaoEvolucao[];
}

export interface PaginaEvolucoes {
  items: Evolucao[];
  limit: number;
  offset: number;
}

// RAS-01: payload JSON (objeto) de até 512 KiB, medido nos bytes UTF-8 do JSON.
export const PAYLOAD_RASCUNHO_MAXIMO = 512 * 1024;
// Bytes UTF-8 sem depender de TextEncoder (o pacote não carrega as libs de DOM nem de Node).
const bytesDoJson = (valor: unknown): number => {
  let bytes = 0;
  for (const caractere of JSON.stringify(valor)) {
    const ponto = caractere.codePointAt(0)!;
    bytes += ponto < 0x80 ? 1 : ponto < 0x800 ? 2 : ponto < 0x10000 ? 3 : 4;
  }
  return bytes;
};
export const esquemaRascunhoEntrada = z.strictObject({
  payload: z
    .record(z.string(), z.unknown())
    .refine((p) => bytesDoJson(p) <= PAYLOAD_RASCUNHO_MAXIMO, 'payload muito grande'),
});
export type RascunhoEntrada = z.output<typeof esquemaRascunhoEntrada>;

export interface Rascunho {
  tipo: string;
  ref: string;
  payload: Record<string, unknown>;
  row_version: number;
  atualizado_em: string;
}

// RAS-03: modelo de texto do tipo evolucao, nome aparado de 1 a 200, corpo até 50.000.
export const NOME_MODELO_MAXIMO = 200;
export const CORPO_MODELO_MAXIMO = 50_000;
const esquemaNomeModelo = z.string().trim().min(1).max(NOME_MODELO_MAXIMO);
const esquemaCorpoModelo = z.string().max(CORPO_MODELO_MAXIMO);

export const esquemaModeloTextoEntrada = z.strictObject({
  tipo: z.literal('evolucao'),
  nome: esquemaNomeModelo,
  corpo: esquemaCorpoModelo,
});
export type ModeloTextoEntrada = z.output<typeof esquemaModeloTextoEntrada>;

// PUT = substituição (como no legado): `arquivado` ausente = false (desarquiva); tipo não muda.
export const esquemaModeloTextoEdicao = z.strictObject({
  nome: esquemaNomeModelo,
  corpo: esquemaCorpoModelo,
  arquivado: z.boolean().optional().default(false),
});
export type ModeloTextoEdicao = z.output<typeof esquemaModeloTextoEdicao>;

export const esquemaListagemModelosTexto = z.object({
  arquivados: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export interface ModeloTexto {
  id: string;
  tipo: 'evolucao';
  nome: string;
  corpo: string;
  arquivado: boolean;
  row_version: number;
}

const problema = (codigo: string, status: number, titulo: string): Problema => ({
  tipo: 'about:blank',
  titulo,
  status,
  codigo,
});

// Evolução, paciente, sessão, rascunho ou modelo inexistente, de outro profissional ou com id
// malformado (ISO-02).
export const PROBLEMA_EVOLUCAO_NAO_ENCONTRADA = problema('nao_encontrado', 404, 'Não encontrado');
// EVO-02: a sessão já tem evolução.
export const PROBLEMA_EVOLUCAO_EXISTENTE = problema(
  'EVOLUTION_EXISTS',
  409,
  'A sessão já tem evolução',
);
// RAS-02: If-Match diferente da versão atual do rascunho.
export const PROBLEMA_VERSAO_RASCUNHO = problema(
  'PRECONDITION_FAILED',
  412,
  'O rascunho mudou; recarregue',
);
// Chave (tipo, ref) ou If-Match do rascunho em formato inválido. PREMISSA: o código 400 de
// consulta do projeto; a chave não é ecoada.
export const PROBLEMA_RASCUNHO_INVALIDO = problema(
  'consulta_invalida',
  400,
  'Chave ou versão do rascunho inválida',
);
// RAS-03: já existe modelo não arquivado com o mesmo nome (sem diferenciar maiúsculas).
export const PROBLEMA_NOME_MODELO_EXISTENTE = problema(
  'TEMPLATE_NAME_EXISTS',
  409,
  'Já existe modelo com este nome',
);
