import {
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_DIA_INDISPONIVEL,
  PROBLEMA_PACIENTE_INATIVO,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  type Sessao,
} from '@es/contrato/agenda';
import type { Problema } from '@es/contrato/identidade';
import {
  FUSO_AGENDA,
  type FimDeSemana,
  conflitos,
  diaHabilitadoNoInstante,
} from '@es/dominio/agenda/conflito';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type Selectable, sql } from 'kysely';
import type { Banco, Trx } from '../db.ts';

// Leitura e checagens da agenda na transação da requisição (RLS: só o que é do profissional da
// sessão; além do RLS, filtra sempre por usuario_id). Adaptado de sessions.repository.ts,
// conflict.repository.ts e do SessionsService do legado. As checagens seguem a ordem do legado:
// paciente (404 se não é do profissional; 422 PATIENT_INACTIVE), dia habilitado (422
// WEEKDAY_UNAVAILABLE) e conflito (409 SCHEDULE_CONFLICT sem confirmar_conflito).

export const COLUNAS_SESSAO = [
  'id',
  'paciente_id',
  'serie_id',
  'inicio',
  'fim',
  'link',
  'status',
  'cobravel',
  'row_version',
  'criado_em',
] as const;

export type LinhaSessao = Pick<
  Selectable<Banco['sessao_atendimento']>,
  (typeof COLUNAS_SESSAO)[number]
>;

export function paraSessao(linha: LinhaSessao): Sessao {
  return {
    id: linha.id,
    paciente_id: linha.paciente_id,
    serie_id: linha.serie_id,
    inicio: linha.inicio.toISOString(),
    fim: linha.fim.toISOString(),
    link: linha.link,
    status: linha.status,
    cobravel: linha.cobravel,
    row_version: linha.row_version,
    criado_em: linha.criado_em.toISOString(),
  };
}

export function responderProblemaAgenda(c: Context, problema: Problema): Response {
  return c.json(problema, problema.status as ContentfulStatusCode, {
    'Content-Type': 'application/problem+json',
  });
}

// Sábado e domingo do perfil; sem perfil, os dois desligados (padrão do perfil, fail-closed).
export async function fimDeSemanaDoPerfil(trx: Trx, usuarioId: string): Promise<FimDeSemana> {
  const perfil = await trx
    .selectFrom('perfil')
    .select(['atende_sabado', 'atende_domingo'])
    .where('usuario_id', '=', usuarioId)
    .executeTakeFirst();
  return { sabado: perfil?.atende_sabado ?? false, domingo: perfil?.atende_domingo ?? false };
}

// Ids das sessões do profissional que ocupam o horário e colidem com [inicio, fim).
export async function conflitosDoHorario(
  trx: Trx,
  usuarioId: string,
  intervalo: { inicio: Date; fim: Date },
  ignorarId?: string,
): Promise<string[]> {
  const candidatas = await trx
    .selectFrom('sessao_atendimento')
    .select(['id', 'inicio', 'fim', 'status'])
    .where('usuario_id', '=', usuarioId)
    .where('inicio', '<', intervalo.fim)
    .where('fim', '>', intervalo.inicio)
    .orderBy('inicio')
    .orderBy('id')
    .execute();
  return conflitos(intervalo, candidatas, ignorarId);
}

export interface PedidoDeHorario {
  usuarioId: string;
  inicio: Date;
  fim: Date;
  confirmarConflito: boolean | undefined;
  // Paciente a conferir (existe, é do profissional e está ativo); ausente = não confere.
  pacienteId?: string;
  checarDia: boolean;
  checarConflito: boolean;
  // A própria sessão, fora da conta do conflito (edição e reabertura).
  ignorarId?: string;
}

export type ResultadoHorario =
  { ok: true; conflitos: string[] } | { ok: false; problema: Problema };

export async function verificarHorario(
  trx: Trx,
  pedido: PedidoDeHorario,
): Promise<ResultadoHorario> {
  if (pedido.pacienteId !== undefined) {
    const paciente = await trx
      .selectFrom('paciente')
      .select('ativo')
      .where('usuario_id', '=', pedido.usuarioId)
      .where('id', '=', pedido.pacienteId)
      .executeTakeFirst();
    if (!paciente) return { ok: false, problema: PROBLEMA_SESSAO_NAO_ENCONTRADA };
    if (!paciente.ativo) return { ok: false, problema: PROBLEMA_PACIENTE_INATIVO };
  }
  if (pedido.checarDia) {
    const fimDeSemana = await fimDeSemanaDoPerfil(trx, pedido.usuarioId);
    if (!diaHabilitadoNoInstante(pedido.inicio, fimDeSemana))
      return { ok: false, problema: PROBLEMA_DIA_INDISPONIVEL };
  }
  let colisoes: string[] = [];
  if (pedido.checarConflito) {
    colisoes = await conflitosDoHorario(
      trx,
      pedido.usuarioId,
      { inicio: pedido.inicio, fim: pedido.fim },
      pedido.ignorarId,
    );
    if (colisoes.length > 0 && pedido.confirmarConflito !== true)
      return { ok: false, problema: PROBLEMA_CONFLITO_HORARIO };
  }
  return { ok: true, conflitos: colisoes };
}

// PERF-06: sessões futuras (início depois do relógio do banco) e não canceladas do profissional
// cujo dia da semana, em America/Sao_Paulo, está em `diasIso` (6 = sábado, 7 = domingo).
// PREMISSA: "não canceladas" é literal (remarcada conta), como no legado (status <> 'cancelada').
export async function contarSessoesFuturasNosDias(
  trx: Trx,
  usuarioId: string,
  diasIso: number[],
): Promise<number> {
  if (diasIso.length === 0) return 0;
  const { total } = await trx
    .selectFrom('sessao_atendimento')
    .select(sql<string>`count(*)`.as('total'))
    .where('usuario_id', '=', usuarioId)
    .where('status', '<>', 'cancelada')
    .where(sql<boolean>`inicio > now()`)
    .where(sql<number>`extract(isodow from inicio at time zone ${FUSO_AGENDA})::int`, 'in', diasIso)
    .executeTakeFirstOrThrow();
  return Number(total);
}
