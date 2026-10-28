import { z } from 'zod';
import type { Problema } from './identidade.ts';
import type { Especialidade } from './perfil.ts';

// EXP-01, EXP-06, EXP-07: contrato da exportação do prontuário de um paciente,
// GET /api/pacientes/:id/prontuario?de=&ate=. Adaptado de record-export.service.ts e
// record-pdf.ts do legado: lá a API devolvia o PDF pronto; aqui devolve o JSON e o app monta o
// PDF no navegador (EXP-02, ADR-008).
// - Período opcional: `de` e `ate` em YYYY-MM-DD, datas de calendário reais, de ≤ até; ausente =
//   sem limite daquele lado. O período filtra só as evoluções, pelo dia do cadastro em
//   America/Sao_Paulo; a anamnese vem sempre (legado). Parâmetro desconhecido também é 400.
// - Anamnese: a versão original, as retificações (com motivo) e a vigente (a de maior seq, ou a
//   original). Cada versão traz só os itens do modelo que existiam na revisão dela, com o rótulo
//   do modelo, campos antes de alertas, cada grupo na ordem do modelo (legado: camposDaVersao).
// - `dia` = data em America/Sao_Paulo do instante `criado_em`.

// Data de calendário real (2026-02-30 não existe), como validDate do legado.
const dataDeCalendario = (texto: string): boolean => {
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
};
const esquemaDia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(dataDeCalendario);

export const esquemaConsultaProntuario = z
  .strictObject({ de: esquemaDia.optional(), ate: esquemaDia.optional() })
  .refine((q) => q.de === undefined || q.ate === undefined || q.de <= q.ate)
  .transform((q) => ({ de: q.de ?? null, ate: q.ate ?? null }));
export type ConsultaProntuario = z.output<typeof esquemaConsultaProntuario>;

export type CampoProntuario =
  | { item_id: string; tipo: 'campo'; rotulo: string; texto: string }
  | { item_id: string; tipo: 'alerta'; rotulo: string; marcado: boolean; obs: string | null };

export interface VersaoAnamneseProntuario {
  modelo_revisao: number;
  campos: CampoProntuario[];
}

export interface RetificacaoAnamneseProntuario extends VersaoAnamneseProntuario {
  seq: number;
  motivo: string;
  criado_em: string;
  dia: string;
}

export interface AnamneseProntuario {
  id: string;
  especialidade: Especialidade;
  data_sessao: string;
  criado_em: string;
  dia: string;
  original: VersaoAnamneseProntuario;
  retificacoes: RetificacaoAnamneseProntuario[];
  // seq da retificação vigente; 0 = a original.
  versao_vigente: number;
  vigente: VersaoAnamneseProntuario;
}

export interface RetificacaoEvolucaoProntuario {
  seq: number;
  texto: string;
  motivo: string;
  criado_em: string;
  dia: string;
}

export interface EvolucaoProntuario {
  id: string;
  sessao_id: string | null;
  criado_em: string;
  dia: string;
  texto: string;
  versao_vigente: number;
  texto_vigente: string;
  retificacoes: RetificacaoEvolucaoProntuario[];
}

// Cabeçalho do PDF (legado: nome, contato e endereço) e registro profissional (EXP-02):
// "conselho número — região", null sem conselho e número.
export interface ProfissionalProntuario {
  nome: string;
  contato: string | null;
  endereco: string | null;
  especialidade: Especialidade | null;
  especialidade_nome: string | null;
  registro: string | null;
}

export interface Prontuario {
  paciente: { id: string; nome: string };
  periodo: ConsultaProntuario;
  // null quando o profissional ainda não tem perfil.
  profissional: ProfissionalProntuario | null;
  anamnese: AnamneseProntuario | null;
  // Em ordem de cadastro.
  evolucoes: EvolucaoProntuario[];
}

const problema = (codigo: string, status: number, titulo: string): Problema => ({
  tipo: 'about:blank',
  titulo,
  status,
  codigo,
});

// EXP-07: paciente de outro profissional, inexistente ou com id malformado (ISO-02).
export const PROBLEMA_PRONTUARIO_NAO_ENCONTRADO = problema('nao_encontrado', 404, 'Não encontrado');
// EXP-07: data fora do formato ou inexistente, de depois de até, ou parâmetro desconhecido.
export const PROBLEMA_PERIODO_INVALIDO = problema('periodo_invalido', 400, 'Período inválido');

// T171 / EXP-03, EXP-04 (D-32): exportação completa paginada, GET /api/exportacao?cursor=&limite=.
// - Cada página traz linhas de uma tabela só, na ordem de TABELAS_EXPORTACAO e, dentro dela, pela
//   chave primária. `proximo_cursor` leva à página seguinte (da mesma tabela ou da próxima);
//   null = última página da exportação. Sem cursor = primeira página (início da exportação).
// - PREMISSA (decisão de 2026-10-27, a confirmar): o cursor é opaco e único, com a tabela e a
//   última chave servida; o app só o devolve como recebeu.
// - Tamanho máximo de página: 25 linhas (T122, medicao-exportacao.md); sem `limite`, o máximo.
//   PREMISSA: o limite é inteiro decimal sem zero à esquerda, de 1 ao máximo.
// - Cada linha é a linha inteira da tabela em JSON (datas em YYYY-MM-DD, instantes em ISO 8601
//   com fuso, centavos como número).
export const TAMANHO_MAXIMO_PAGINA = 25;

// Lista do legado (export-full.domain.ts) restrita às tabelas que existem aqui, sem relatorio
// (D-01), mais preco_sessao, preco_sessao_revisao e preco_paciente_revisao. As tabelas novas
// (assinatura, audit_log, push_subscription, notificacao_enviada, limite_uso, aceite_termos)
// ficam de fora; credenciais e sessões nunca entram (decisão de 2026-10-27, PREMISSA).
export const TABELAS_EXPORTACAO = [
  'perfil',
  'modelo_anamnese',
  'modelo_anamnese_item',
  'paciente',
  'consentimento_tcle',
  'serie_recorrencia',
  'sessao_atendimento',
  'anamnese',
  'anamnese_retificacao',
  'evolucao',
  'evolucao_retificacao',
  'rascunho',
  'modelo_texto',
  'preco_paciente',
  'preco_paciente_revisao',
  'preco_sessao',
  'preco_sessao_revisao',
  'pagamento',
  'pagamento_revisao',
  'configuracao_usuario',
] as const;
export type TabelaExportacao = (typeof TABELAS_EXPORTACAO)[number];

export const esquemaConsultaExportacao = z
  .strictObject({
    cursor: z.string().min(1).optional(),
    limite: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(z.number().int().max(TAMANHO_MAXIMO_PAGINA))
      .optional(),
  })
  .transform((q) => ({ cursor: q.cursor ?? null, limite: q.limite ?? TAMANHO_MAXIMO_PAGINA }));
export type ConsultaExportacao = z.output<typeof esquemaConsultaExportacao>;

export interface PaginaExportacao {
  tabela: TabelaExportacao;
  linhas: Record<string, unknown>[];
  proximo_cursor: string | null;
}

// EXP-04: limite acima do máximo ou fora do formato, ou parâmetro desconhecido.
export const PROBLEMA_PAGINA_INVALIDA = problema('pagina_invalida', 400, 'Página inválida');
// EXP-04: cursor que a API não emitiu (fora do formato, tabela fora da lista ou chave inválida).
export const PROBLEMA_CURSOR_INVALIDO = problema('cursor_invalido', 400, 'Cursor inválido');

// T172 / EXP-05: no máximo 5 exportações completas iniciadas (primeira página, sem cursor) por
// janela de 60 s, com o contador em limite_uso; a sexta responde 429. PREMISSA: código
// limite_exportacao e título do problema escritos pelo implementador.
export const LIMITE_EXPORTACOES = 5;
export const JANELA_LIMITE_EXPORTACAO_SEGUNDOS = 60;
export const PROBLEMA_LIMITE_EXPORTACAO = problema('limite_exportacao', 429, 'Muitas exportações');
