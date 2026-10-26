import { z } from 'zod';
import type { Problema } from './identidade.ts';

// FIN-01 a FIN-08: contrato do financeiro (preço por paciente, ajuste por sessão, pagamento e
// débitos). Adaptado de price.ts, payment.ts e debts.ts do legado, com dinheiro em centavos
// inteiros (ADR-007): o legado trafegava reais com até 2 casas; aqui `valor` é inteiro de 0 a
// 9.999.999.999 e decimal é recusado. Corpo estrito: campo extra = 422 `validacao`.
// Decisões do usuário (2026-10-26):
// - preço: PUT cria sem row_version e edita com o row_version lido; criar com versão ou editar
//   sem ela ou com versão divergente = 409 `versao_divergente`; sem preço, GET = 404;
// - pagamento: PUT único por sessão (201 cria, 200 corrige), sem row_version; valor ausente usa o
//   preço da sessão ou do paciente; sem nenhum = 422 PRICE_REQUIRED; duplicado sem
//   confirmar_duplicidade = 422 PAYMENT_DUPLICATE;
// - débitos: GET /api/debitos?status=em_debito|em_dia (ausente = todos) com `total_pendente`, e
//   GET /api/debitos/:pacienteId com as sessões pendentes; todos os pacientes, sem paginação.

// FIN-01: centavos inteiros, o mesmo teto do numeric(10,2) do legado.
export const VALOR_MAXIMO_CENTAVOS = 9_999_999_999;
export const esquemaCentavos = z.number().int().min(0).max(VALOR_MAXIMO_CENTAVOS);

const esquemaVersao = z.number().int().positive();

// PUT /api/pacientes/:id/preco e /api/sessoes/:id/preco.
export const esquemaPrecoEntrada = z.strictObject({
  valor: esquemaCentavos,
  row_version: esquemaVersao.optional(),
});
export type PrecoEntrada = z.output<typeof esquemaPrecoEntrada>;

export interface PrecoPaciente {
  paciente_id: string;
  valor: number;
  row_version: number;
  criado_em: string;
}

export interface PrecoSessao {
  sessao_id: string;
  valor: number;
  row_version: number;
  criado_em: string;
}

// FIN-03: lista fechada do legado (0022). A entrada aceita maiúsculas e acentos ("Cartão") e é
// gravada em minúsculas sem acento, como no legado.
export const MEIOS_PAGAMENTO = ['dinheiro', 'pix', 'cartao', 'transferencia', 'outro'] as const;
export type MeioPagamento = (typeof MEIOS_PAGAMENTO)[number];
const esquemaMeio = z
  .string()
  .transform((v) => v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
  .pipe(z.enum(MEIOS_PAGAMENTO));

// Data de calendário real (2026-02-30 não existe).
const dataDeCalendario = (texto: string): boolean => {
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
};
const esquemaData = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(dataDeCalendario, 'data inválida');

// PUT /api/sessoes/:id/pagamento (FIN-03, FIN-05).
export const esquemaPagamentoEntrada = z.strictObject({
  data: esquemaData,
  meio: esquemaMeio,
  valor: esquemaCentavos.optional(),
  confirmar_duplicidade: z.boolean().optional(),
});
export type PagamentoEntrada = z.output<typeof esquemaPagamentoEntrada>;

export interface Pagamento {
  id: string;
  sessao_id: string;
  valor: number;
  data: string;
  meio: MeioPagamento;
  row_version: number;
  criado_em: string;
}

// GET /api/debitos (FIN-07): filtro do legado; ausente = todos; outro valor ou chave = 400.
export const SITUACOES_DEBITO = ['em_debito', 'em_dia'] as const;
export type SituacaoDebito = (typeof SITUACOES_DEBITO)[number];
export const esquemaFiltroDebitos = z.strictObject({
  status: z.enum(SITUACOES_DEBITO).optional(),
});
export type FiltroDebitos = z.output<typeof esquemaFiltroDebitos>;

export interface ItemDebito {
  paciente_id: string;
  nome: string;
  status: SituacaoDebito;
  sessoes_pendentes: number;
  valor_pendente: number;
}

export interface ListaDebitos {
  items: ItemDebito[];
  // Soma do valor_pendente dos itens da lista, em centavos.
  total_pendente: number;
}

// Sessão pendente; `valor` null = sem preço da sessão nem do paciente (conta 0 nos totais).
export interface SessaoPendente {
  sessao_id: string;
  inicio: string;
  status: string;
  valor: number | null;
}

export interface PendenciasPaciente {
  paciente_id: string;
  nome: string;
  sessoes: SessaoPendente[];
  total_sessoes: number;
  valor_pendente: number;
}

const problema = (codigo: string, status: number, titulo: string): Problema => ({
  tipo: 'about:blank',
  titulo,
  status,
  codigo,
});

// Paciente, sessão ou preço inexistente, de outro profissional ou com id malformado (ISO-02).
export const PROBLEMA_FINANCEIRO_NAO_ENCONTRADO = problema('nao_encontrado', 404, 'Não encontrado');
// FIN-02: criar com row_version, editar sem ela ou com versão diferente da atual.
export const PROBLEMA_VERSAO_PRECO = problema(
  'versao_divergente',
  409,
  'Alguém alterou isto; recarregue',
);
// FIN-04: pagamento sem valor e sem preço (decisão do usuário: código em maiúsculas).
export const PROBLEMA_PRECO_OBRIGATORIO = problema(
  'PRICE_REQUIRED',
  422,
  'Informe o valor: não há preço definido',
);
// FIN-05: a sessão já tem pagamento e não veio confirmar_duplicidade.
export const PROBLEMA_PAGAMENTO_DUPLICADO = problema(
  'PAYMENT_DUPLICATE',
  422,
  'A sessão já tem pagamento',
);
// Filtro da listagem de débitos inválido.
export const PROBLEMA_CONSULTA_DEBITOS_INVALIDA = problema(
  'consulta_invalida',
  400,
  'Consulta inválida',
);
