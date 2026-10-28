import { z } from 'zod';
import type { Problema } from './identidade.ts';

// CONTA-01 a CONTA-04: contrato das rotas de exclusão de conta. Sem equivalente no legado.
// - Pedir (POST /api/conta/excluir, autenticada): senha e a declaração de que o profissional
//   assume a guarda do prontuário. Os dois campos são opcionais no corpo: ausente conta como
//   requisito que falta (422 requisitos_exclusao), não como erro de formato. Tipo errado ou chave
//   desconhecida: 422 validacao.
// - Confirmar (POST /api/conta/excluir/confirmar) e desistir (POST /api/conta/desistir): públicas,
//   só com o token do link do e-mail (como a confirmação de cadastro). Token malformado é "link
//   inválido" (400), nunca erro de validação.

const token = z.string().max(512);

export const esquemaPedirExclusao = z.strictObject({
  senha: z.string().max(256).optional(),
  declaracao_guarda: z.boolean().optional(),
});
export type PedirExclusao = z.infer<typeof esquemaPedirExclusao>;

// CONTA-01: requisitos do pedido, na ordem em que aparecem no 422.
// - exportacao: nenhuma exportação completa concluída (última página servida, exportacao.concluida)
//   nas últimas 24 horas;
// - declaracao_guarda: a declaração de guarda do prontuário não veio marcada (true);
// - senha: senha ausente ou errada.
export const REQUISITOS_EXCLUSAO = ['exportacao', 'declaracao_guarda', 'senha'] as const;
export type RequisitoExclusao = (typeof REQUISITOS_EXCLUSAO)[number];

export const problemaRequisitosExclusao = (requisitos: RequisitoExclusao[]): Problema => ({
  tipo: 'about:blank',
  titulo: 'Faltam requisitos para excluir a conta',
  status: 422,
  codigo: 'requisitos_exclusao',
  requisitos,
});

// CONTA-02: 202 do pedido aceito; o link de confirmação vai ao e-mail da conta.
export const RESPOSTA_PEDIR_EXCLUSAO = { status: 'confirmacao_enviada' } as const;

export const esquemaTokenExclusao = z.strictObject({ token });
