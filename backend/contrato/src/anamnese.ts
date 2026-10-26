import { z } from 'zod';
import type { Problema } from './identidade.ts';

// ANA-01, ANA-04, ANA-06: contrato da anamnese configurável (modelo, anamnese e retificação).
// Adaptado de anamnesis.domain.ts e do controller do modelo do legado, sem o schema morto de
// 20.000 e 5.000 e sem especialidade_id (o profissional tem uma só). Corpo estrito: campo extra é
// recusado (422 `validacao`, só com os nomes dos campos). O conteúdo fica com o domínio
// (backend/dominio/src/anamnese): limites e rótulos do modelo (ANA-01, ANA-02) e os valores
// (ANA-04), que nunca ecoam texto clínico.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esquemaId = z.string().regex(UUID, 'id inválido');
const esquemaRevisao = z.number().int().min(1).max(1_000_000);
// Valores por id de item do modelo; o domínio valida id, tipo e tamanho.
const esquemaValores = z.record(z.string(), z.unknown());

const dataDeCalendario = (texto: string): boolean => {
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
};

// PUT do modelo: listas completas de campos e alertas, na ordem. Item sem id = item novo. Os
// limites (30 campos, 12 alertas, rótulo aparado de 1 a 60, único) e o especial único são do
// domínio, para a violação responder MODEL_LABEL_INVALID e não `validacao`. PREMISSA: tetos
// contra abuso (4 vezes os limites, como no legado) respondem 422 `validacao`.
const esquemaItemModelo = z.strictObject({
  id: esquemaId.optional(),
  rotulo: z.string().max(240),
  especial: z.literal('frequencia').optional(),
});
export const esquemaModeloEdicao = z.strictObject({
  campos: z.array(esquemaItemModelo).max(120),
  alertas: z.array(esquemaItemModelo).max(48),
});
export type ModeloEdicao = z.output<typeof esquemaModeloEdicao>;

// Registro da anamnese (uma por paciente). `data_sessao` vem do legado.
export const esquemaAnamneseEntrada = z.strictObject({
  data_sessao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(dataDeCalendario, 'data inválida'),
  modelo_revisao: esquemaRevisao,
  valores: esquemaValores.default({}),
});
export type AnamneseEntrada = z.output<typeof esquemaAnamneseEntrada>;

// Edição no dia do cadastro (ANA-05): nova revisão e valores completos; a data não muda.
export const esquemaAnamneseEdicao = z.strictObject({
  modelo_revisao: esquemaRevisao,
  valores: esquemaValores,
});
export type AnamneseEdicao = z.output<typeof esquemaAnamneseEdicao>;

// ANA-06: retificação = nova versão completa (revisão e valores) com motivo aparado de 1 a 5.000.
export const MOTIVO_MAXIMO = 5000;
export const esquemaRetificacaoEntrada = z.strictObject({
  modelo_revisao: esquemaRevisao,
  valores: esquemaValores.default({}),
  motivo: z.string().trim().min(1).max(MOTIVO_MAXIMO),
});
export type RetificacaoEntrada = z.output<typeof esquemaRetificacaoEntrada>;

// ANA-01, ANA-02: modelo com limite, rótulo ou especial inválido. Corpo fixo: nunca leva o texto
// do rótulo (conteúdo clínico).
export const PROBLEMA_ROTULO_INVALIDO: Problema = {
  tipo: 'about:blank',
  titulo: 'Rótulo inválido no modelo',
  status: 422,
  codigo: 'MODEL_LABEL_INVALID',
};
