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

// 200 de POST /api/plano/cancelar (PLANO-11): cancelada no Asaas e no app; o Pro segue até
// periodo_fim, quando o cron leva a free.
export interface RespostaCancelar {
  status: 'cancelada';
  periodo_fim: string;
}

// 200 de GET /api/plano (PLANO-14, PLANO-05): "Meu plano".
// - `plano` e `status` são os efetivos agora (regras da T125): trial ou cancelada depois de
//   periodo_fim e atrasada com os 7 dias esgotados já aparecem como free, antes do cron.
// - `data`: renovação em ativa (periodo_fim); fim do Pro em trial e cancelada (periodo_fim) e em
//   atrasada (fim da tolerância de 7 dias); null no free.
// - `pix`: só com cobrança pendente (status PENDING no Asaas) da assinatura; o QR é buscado na
//   hora e não é gravado. Mais de uma pendente: a de vencimento mais antigo.
export type EstadoPlano = 'trial' | 'ativa' | 'atrasada' | 'cancelada' | 'free';

export interface PixPendente {
  valor_centavos: number;
  vencimento: string; // AAAA-MM-DD
  copia_e_cola: string;
  qr_code_png_base64: string;
  expira_em: string; // como o Asaas devolve (AAAA-MM-DD HH:MM:SS)
}

export interface RespostaPlano {
  plano: 'pro' | 'free';
  status: EstadoPlano;
  data: { tipo: 'renovacao' | 'fim'; em: string } | null;
  pix: PixPendente | null;
}

const problema = (codigo: string, status: number, titulo: string): Problema => ({
  tipo: 'about:blank',
  titulo,
  status,
  codigo,
});

// Decisão do usuário (2026-10-27): assinar só em trial e free; cancelar só em ativa. Os demais
// estados respondem 409.
// PREMISSA: também 409 sem assinatura e em trial que já tem assinatura criada no Asaas (a
// cobrança pendente já está em "Meu plano"; outra geraria cobrança em dobro).
export const PROBLEMA_ASSINATURA_ESTADO = problema(
  'assinatura_estado_invalido',
  409,
  'A assinatura não permite esta operação no estado atual',
);
// PLANO-03, D-20: Free com 5 ou mais pacientes ativos ao criar ou reativar paciente; também o
// 403 do exigePlano('pro') (design: aviso com link para "Meu plano").
export const PROBLEMA_LIMITE_PLANO = problema('LIMITE_PLANO', 403, 'Limite do plano Free atingido');
// PLANO-12: Asaas fora ou lento (design: "Cobrança indisponível, tente em instantes").
export const PROBLEMA_COBRANCA_INDISPONIVEL = problema(
  'cobranca_indisponivel',
  503,
  'Cobrança indisponível, tente em instantes',
);
