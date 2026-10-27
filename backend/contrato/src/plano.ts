import { z } from 'zod';
import type { Problema } from './identidade.ts';

// PLANO-05, PLANO-11, PLANO-12: contrato das rotas do plano. Sem equivalente no legado.
// - Assinar o Pro pede nome e CPF/CNPJ (o Asaas recusa a assinatura Pix sem CPF/CNPJ, spike S3).
//   O documento é validado pelo dígito verificador antes de chamar o Asaas; inválido = 422.
// - PREMISSA: o CPF/CNPJ pode vir com a máscara usual (pontos, traço, barra, espaços), que é
//   retirada; o CNPJ alfanumérico (12 caracteres de 0-9 e A-Z, mais 2 dígitos) é aceito, com o
//   mesmo cálculo (valor do caractere = código ASCII - 48). O Asaas não foi testado com ele.

const PESOS_CPF_1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CPF_2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

const valor = (caractere: string): number => caractere.charCodeAt(0) - 48;

function digito(base: string, pesos: number[]): number {
  const soma = pesos.reduce((total, peso, i) => total + valor(base[i]!) * peso, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  return (
    digito(cpf, PESOS_CPF_1) === valor(cpf[9]!) && digito(cpf, PESOS_CPF_2) === valor(cpf[10]!)
  );
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  return (
    digito(cnpj, PESOS_CNPJ_1) === valor(cnpj[12]!) &&
    digito(cnpj, PESOS_CNPJ_2) === valor(cnpj[13]!)
  );
}

export const esquemaCpfCnpj = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z.\-/ ]{11,20}$/)
  .transform((v) => v.replace(/[.\-/ ]/g, '').toUpperCase())
  .refine((v) => cpfValido(v) || cnpjValido(v), 'CPF/CNPJ inválido');

export const esquemaAssinarEntrada = z.strictObject({
  nome: z.string().trim().min(1).max(200),
  cpf_cnpj: esquemaCpfCnpj,
});
export type AssinarEntrada = z.output<typeof esquemaAssinarEntrada>;

// 201 de POST /api/plano/assinar: a cobrança Pix foi gerada no Asaas; o Pix e o QR aparecem em
// "Meu plano" (GET /api/plano, T134) e o estado só muda com o webhook de pagamento (PLANO-08).
export const RESPOSTA_ASSINAR = { status: 'aguardando_pagamento' } as const;

const problema = (codigo: string, status: number, titulo: string): Problema => ({
  tipo: 'about:blank',
  titulo,
  status,
  codigo,
});

// Decisão do usuário (2026-10-27): assinar só em trial e free. Os demais estados respondem 409.
// PREMISSA: também 409 sem assinatura e em trial que já tem assinatura criada no Asaas (a
// cobrança pendente já está em "Meu plano"; outra geraria cobrança em dobro).
export const PROBLEMA_ASSINATURA_ESTADO = problema(
  'assinatura_estado_invalido',
  409,
  'A assinatura não permite esta operação no estado atual',
);
// PLANO-12: Asaas fora ou lento (design: "Cobrança indisponível, tente em instantes").
export const PROBLEMA_COBRANCA_INDISPONIVEL = problema(
  'cobranca_indisponivel',
  503,
  'Cobrança indisponível, tente em instantes',
);
