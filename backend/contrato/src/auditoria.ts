import { z } from 'zod';
import type { Problema } from './identidade.ts';

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

// AUD-03: leitura da trilha em GET /api/auditoria. Adaptado de account.controller.ts,
// patient-history.controller.ts e audit-query.repository.ts do legado.
// - Sem paciente_id: "Trilha da minha conta"; com paciente_id: "Histórico do paciente" (eventos
//   do paciente e dos registros dele: evolução, anamnese, sessão, série e pagamento).
// - Filtro no servidor (o legado filtrava só o que já tinha carregado): todos, retificacoes
//   (ações *.retificada) ou exportacoes (ações exportacao.*). Ausente = todos.
// - Páginas de 50 (limit de 1 a 100, como no legado), do mais novo ao mais antigo; o cursor é o
//   id do último evento da página (texto decimal, como no legado) e vem null na última.
// - paciente.consultado nunca aparece. Parâmetro desconhecido ou valor inválido: 400.
export const FILTROS_AUDITORIA = ['todos', 'retificacoes', 'exportacoes'] as const;
export type FiltroAuditoria = (typeof FILTROS_AUDITORIA)[number];

export const ACOES_DO_FILTRO_AUDITORIA: Record<
  Exclude<FiltroAuditoria, 'todos'>,
  readonly AcaoAuditoria[]
> = {
  retificacoes: ACOES_AUDITORIA.filter((a) => a.endsWith('.retificada')),
  exportacoes: ACOES_AUDITORIA.filter((a) => a.startsWith('exportacao.')),
};

export const ACOES_FORA_DA_TRILHA: readonly AcaoAuditoria[] = ['paciente.consultado'];

export const LIMITE_PADRAO_AUDITORIA = 50;
export const LIMITE_MAXIMO_AUDITORIA = 100;

export const esquemaConsultaAuditoria = z
  .strictObject({
    filtro: z.enum(FILTROS_AUDITORIA).optional(),
    paciente_id: z.string().optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(LIMITE_MAXIMO_AUDITORIA))
      .optional(),
    cursor: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
  })
  .transform((q) => ({
    filtro: q.filtro ?? 'todos',
    limit: q.limit ?? LIMITE_PADRAO_AUDITORIA,
    cursor: q.cursor ?? null,
    paciente_id: q.paciente_id ?? null,
  }));
export type ConsultaAuditoria = z.output<typeof esquemaConsultaAuditoria>;

// Só metadados do audit_log; nunca conteúdo clínico.
export interface EventoTrilha {
  id: string;
  acao: string;
  alvo_tipo: string;
  alvo_id: string | null;
  campos_alterados: string[];
  origem_ip: string | null;
  origem_ua: string | null;
  ocorrido_em: string;
}

export interface PaginaAuditoria {
  items: EventoTrilha[];
  proximo_cursor: string | null;
}

const problema = (codigo: string, status: number, titulo: string): Problema => ({
  tipo: 'about:blank',
  titulo,
  status,
  codigo,
});

// Paciente inexistente, de outro profissional ou com id malformado (ISO-02).
export const PROBLEMA_AUDITORIA_NAO_ENCONTRADA = problema('nao_encontrado', 404, 'Não encontrado');
// Filtro, limit, cursor ou parâmetro desconhecido.
export const PROBLEMA_CONSULTA_AUDITORIA_INVALIDA = problema(
  'consulta_invalida',
  400,
  'Consulta inválida',
);
