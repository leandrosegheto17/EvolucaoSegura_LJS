import { z } from 'zod';

// AUD-01, AUD-02, AUD-04: evento de auditoria. Lista copiada do legado
// (backend/src/audit/domain/audit-event.ts) sem as ações de IA, relatório, Google e whitelist,
// mais as ações novas de acesso, cadastro, assinatura e exclusão. Nunca leva conteúdo clínico:
// chave extra é recusada e camposAlterados só aceita nomes de coluna.

export const ACOES_AUDITORIA = [
  'evolucao.criada',
  'evolucao.editada_no_dia',
  'evolucao.retificada',
  'evolucao.edicao_recusada',
  'pagamento.registrado',
  'pagamento.corrigido',
  'auth.login_falhou',
  'exportacao.concluida',
  'paciente.consultado',
  'auth.senha_recuperada',
  'auth.senha_redefinida',
  'perfil.editado',
  'configuracao.alterada',
  'sessao.criada',
  'sessao.editada',
  'sessao.status_alterado',
  'serie.criada',
  'serie.editada',
  'serie.cancelada',
  'anamnese.criada',
  'anamnese.editada_no_dia',
  'anamnese.edicao_recusada',
  'anamnese.retificada',
  'preco_paciente.definido',
  'preco_sessao.ajustado',
  'paciente.inativado',
  'paciente.reativado',
  'modelo_anamnese.editado',
  // AUD-04
  'auth.login_ok',
  'auth.logout',
  'conta.cadastrada',
  // assinatura.<estado>: um por estado da assinatura (design, EstadoAssinatura).
  'assinatura.trial',
  'assinatura.ativa',
  'assinatura.atrasada',
  'assinatura.cancelada',
  'assinatura.free',
  // conta.exclusao_<etapa>: pedido (CONTA-02), confirmação (CONTA-03) e desistência (CONTA-04).
  // A purga (CONTA-05) apaga a própria trilha, então não tem evento.
  'conta.exclusao_pedida',
  'conta.exclusao_confirmada',
  'conta.exclusao_desistida',
] as const;
export type AcaoAuditoria = (typeof ACOES_AUDITORIA)[number];

export const ALVOS_AUDITORIA = [
  'evolucao',
  'anamnese',
  'pagamento',
  'paciente',
  'agendamento',
  'perfil',
  'modelo_anamnese',
  'configuracao',
  'conta',
  'exportacao',
  'auth',
] as const;
export type AlvoAuditoria = (typeof ALVOS_AUDITORIA)[number];

// Eventos sem profissional (cron, webhook) usam 'sistema'; scripts de operação, 'admin-cli'.
export const esquemaAtorAuditoria = z.union([
  z.uuid(),
  z.literal('sistema'),
  z.literal('admin-cli'),
]);

export const esquemaEventoAuditoria = z.strictObject({
  usuarioId: z.uuid(),
  ator: esquemaAtorAuditoria,
  acao: z.enum(ACOES_AUDITORIA),
  alvoTipo: z.enum(ALVOS_AUDITORIA),
  alvoId: z.uuid().nullable().optional(),
  // Nomes de coluna, nunca valores.
  camposAlterados: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/))
    .max(50)
    .optional(),
  // IP e user-agent brutos da requisição; o repositório trunca e resume antes de gravar.
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
});
export type EventoAuditoria = z.infer<typeof esquemaEventoAuditoria>;
