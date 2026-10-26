import { z } from 'zod';
import type { Problema } from './identidade.ts';

// AGE-01, AGE-03, AGE-07: contrato das rotas de sessões (criar, listar, editar e mudar status).
// Adaptado de backend/src/scheduling/domain/session.ts do legado. Corpo estrito: campo extra é
// recusado (422). As regras de transição, conflito e dia habilitado ficam no domínio
// (backend/dominio/src/agenda); aqui só o formato.

export const STATUS_SESSAO = ['agendada', 'realizada', 'faltou', 'cancelada', 'remarcada'] as const;
export type StatusSessao = (typeof STATUS_SESSAO)[number];

// AGE-01: ISO 8601 com offset obrigatório (Z ou ±hh:mm) e ano entre 2000 e 2100, tanto o ano
// escrito quanto o ano em UTC (2100-12-31T23:00-03:00 é 2101 em UTC: recusado). Data e hora
// precisam existir no calendário (o Date.parse aceita 30 de fevereiro e 24:00; aqui não).
export const ANO_MINIMO = 2000;
export const ANO_MAXIMO = 2100;
const FORMATO_INSTANTE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-])(\d{2}):(\d{2}))$/i;

const diasDoMes = (ano: number, mes: number): number =>
  new Date(Date.UTC(ano, mes, 0)).getUTCDate();

export function instanteValido(texto: string): boolean {
  const partes = FORMATO_INSTANTE.exec(texto);
  if (!partes) return false;
  const [ano, mes, dia, hora, minuto] = partes.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const segundo = partes[6] === undefined ? 0 : Number(partes[6]);
  const offsetHora = partes[8] === undefined ? 0 : Number(partes[8]);
  const offsetMinuto = partes[9] === undefined ? 0 : Number(partes[9]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDoMes(ano, mes)) return false;
  if (hora > 23 || minuto > 59 || segundo > 59 || offsetHora > 23 || offsetMinuto > 59)
    return false;
  const instante = Date.parse(texto);
  if (Number.isNaN(instante)) return false;
  const anoUtc = new Date(instante).getUTCFullYear();
  return ano >= ANO_MINIMO && ano <= ANO_MAXIMO && anoUtc >= ANO_MINIMO && anoUtc <= ANO_MAXIMO;
}

export const esquemaInstante = z
  .string()
  .refine(instanteValido, `data e hora ISO 8601 com offset, ano de ${ANO_MINIMO} a ${ANO_MAXIMO}`);

// AGE-01: link opcional, aparado, até 500, começando com http:// ou https://; vazio = sem link.
export const LINK_MAXIMO = 500;
const esquemaLink = z
  .string()
  .trim()
  .max(LINK_MAXIMO)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), 'link inválido');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esquemaId = z.string().regex(UUID, 'id inválido');
const esquemaVersao = z.number().int().positive();

const fimDepoisDoInicio = (s: { inicio: string; fim: string }) =>
  Date.parse(s.fim) > Date.parse(s.inicio);
const MENSAGEM_FIM = { message: 'fim deve ser posterior ao início', path: ['fim'] };

// POST /api/sessoes. `cobravel` só vale para falta e cancelamento (AGE-10; padrão falso no banco).
export const esquemaSessaoEntrada = z
  .strictObject({
    paciente_id: esquemaId,
    inicio: esquemaInstante,
    fim: esquemaInstante,
    link: esquemaLink,
    cobravel: z.boolean().optional(),
    confirmar_conflito: z.boolean().optional(),
  })
  .refine(fimDepoisDoInicio, MENSAGEM_FIM);
export type SessaoEntrada = z.output<typeof esquemaSessaoEntrada>;

// PUT /api/sessoes/:id (AGE-11): horário e link substituem os atuais (link ausente = sem link);
// paciente e cobravel ausentes ficam como estão. row_version é obrigatório.
export const esquemaSessaoEdicao = z
  .strictObject({
    paciente_id: esquemaId.optional(),
    inicio: esquemaInstante,
    fim: esquemaInstante,
    link: esquemaLink,
    cobravel: z.boolean().optional(),
    confirmar_conflito: z.boolean().optional(),
    row_version: esquemaVersao,
  })
  .refine(fimDepoisDoInicio, MENSAGEM_FIM);
export type SessaoEdicao = z.output<typeof esquemaSessaoEdicao>;

// POST /api/sessoes/:id/status (AGE-07, AGE-10, AGE-11). `cobravel: true` é o "cobrar" da falta
// ou do cancelamento.
export const esquemaMudancaStatus = z.strictObject({
  status: z.enum(STATUS_SESSAO),
  cobravel: z.boolean().optional(),
  confirmar_conflito: z.boolean().optional(),
  row_version: esquemaVersao,
});
export type MudancaStatus = z.output<typeof esquemaMudancaStatus>;

export interface Sessao {
  id: string;
  paciente_id: string;
  serie_id: string | null;
  inicio: string;
  fim: string;
  link: string | null;
  status: StatusSessao;
  cobravel: boolean;
  row_version: number;
  criado_em: string;
}

// AGE-03: listagem do intervalo [de, ate) de no máximo 62 dias, com limit de 1 a 100 (padrão
// 50) e cursor keyset opaco (início e id da última sessão da página). Parâmetro desconhecido é
// ignorado, como na listagem de pacientes.
export const INTERVALO_MAXIMO_DIAS = 62;
export const LIMITE_PADRAO_SESSOES = 50;
export const LIMITE_MAXIMO_SESSOES = 100;
const DIA_MS = 86_400_000;

export interface Cursor {
  inicio: string;
  id: string;
}

// O cursor é o texto "inicio|id" (só ASCII) em hexadecimal: opaco para o app e sem depender de
// btoa ou TextEncoder, para o contrato rodar igual no Worker, no navegador e no Node.
const paraHex = (texto: string): string =>
  Array.from(texto, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

export const codificarCursor = (cursor: Cursor): string => paraHex(`${cursor.inicio}|${cursor.id}`);

// Cursor malformado = null (a listagem responde 400).
export function decodificarCursor(texto: string): Cursor | null {
  if (texto.length === 0 || texto.length > 200 || !/^(?:[0-9a-f]{2})+$/.test(texto)) return null;
  const decodificado = (texto.match(/../g) ?? [])
    .map((par) => String.fromCharCode(parseInt(par, 16)))
    .join('');
  const [inicio, id, ...resto] = decodificado.split('|');
  if (resto.length > 0 || inicio === undefined || id === undefined) return null;
  if (!UUID.test(id) || !instanteValido(inicio)) return null;
  // O início fica como veio (com os microssegundos do banco): truncar em milissegundos faria a
  // última sessão da página voltar na seguinte.
  return { inicio, id: id.toLowerCase() };
}

const inteiroDaQuery = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int());

export const esquemaListagemSessoes = z
  .object({
    de: esquemaInstante,
    ate: esquemaInstante,
    limit: inteiroDaQuery
      .pipe(z.number().min(1).max(LIMITE_MAXIMO_SESSOES))
      .optional()
      .transform((v) => v ?? LIMITE_PADRAO_SESSOES),
    cursor: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return null;
        const cursor = decodificarCursor(v);
        if (cursor === null) {
          ctx.addIssue({ code: 'custom', message: 'cursor inválido' });
          return z.NEVER;
        }
        return cursor;
      }),
  })
  .refine((q) => Date.parse(q.ate) > Date.parse(q.de), {
    message: 'ate deve ser posterior a de',
    path: ['ate'],
  })
  .refine((q) => Date.parse(q.ate) - Date.parse(q.de) <= INTERVALO_MAXIMO_DIAS * DIA_MS, {
    message: `intervalo de no máximo ${INTERVALO_MAXIMO_DIAS} dias`,
    path: ['ate'],
  })
  .transform((q) => ({
    de: new Date(q.de).toISOString(),
    ate: new Date(q.ate).toISOString(),
    limit: q.limit,
    cursor: q.cursor,
  }));
export type ListagemSessoes = z.output<typeof esquemaListagemSessoes>;

export interface PaginaSessoes {
  items: Sessao[];
  proximo_cursor: string | null;
}

// Erros da agenda (problem+json). Os códigos em maiúsculas são os da spec (AGE-04, AGE-06,
// AGE-08, AGE-12); os demais seguem o padrão do projeto.
const problemaAgenda = (codigo: string, status: number, titulo: string): Problema => ({
  tipo: 'about:blank',
  titulo,
  status,
  codigo,
});

// AGE-04: sobreposição com sessão agendada, realizada ou faltou, sem confirmar_conflito.
export const PROBLEMA_CONFLITO_HORARIO = problemaAgenda(
  'SCHEDULE_CONFLICT',
  409,
  'Conflito de horário',
);
// AGE-06: sábado ou domingo desligado no perfil.
export const PROBLEMA_DIA_INDISPONIVEL = problemaAgenda(
  'WEEKDAY_UNAVAILABLE',
  422,
  'Dia sem atendimento',
);
// AGE-12: paciente inativo.
export const PROBLEMA_PACIENTE_INATIVO = problemaAgenda(
  'PATIENT_INACTIVE',
  422,
  'Paciente inativo',
);
// AGE-08: realizada para cancelada com evolução ou pagamento.
export const PROBLEMA_SESSAO_COM_REGISTROS = problemaAgenda(
  'SESSION_HAS_RECORDS',
  422,
  'Sessão com registros',
);
// AGE-07: transição fora da matriz.
export const PROBLEMA_TRANSICAO_INVALIDA = problemaAgenda(
  'transicao_invalida',
  422,
  'Transição de status inválida',
);
// AGE-11: row_version diferente do atual.
export const PROBLEMA_VERSAO_DIVERGENTE = problemaAgenda(
  'versao_divergente',
  409,
  'Alguém alterou isto; recarregue',
);
// Sessão (ou paciente) inexistente, de outro profissional ou com id malformado (ISO-02).
export const PROBLEMA_SESSAO_NAO_ENCONTRADA = problemaAgenda(
  'nao_encontrado',
  404,
  'Não encontrado',
);
// AGE-03: de, ate, limit ou cursor inválidos na listagem.
export const PROBLEMA_CONSULTA_SESSOES_INVALIDA = problemaAgenda(
  'consulta_invalida',
  400,
  'Consulta inválida',
);
