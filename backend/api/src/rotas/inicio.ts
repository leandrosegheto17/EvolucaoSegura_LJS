import type { ResumoInicio } from '@es/contrato/inicio';
import { diaHabilitado } from '@es/dominio/agenda/conflito';
import {
  LIMITE_HOJE,
  estadoEvolucao,
  estadoPagamento,
  semanaDeAtendimento,
} from '@es/dominio/inicio/resumo';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { fimDeSemanaDoPerfil } from '../repositorios/sessoes.ts';

// INI-01, INI-02, INI-03, ISO-02: GET /api/inicio, rota autenticada e só de leitura. Adaptado de
// HomeService e home.repository.ts do legado, no mesmo formato de resposta.
// - "Hoje" e a semana vêm do relógio do banco em America/Sao_Paulo: a semana vai de segunda até o
//   último dia habilitado no perfil (sem perfil, sábado e domingo desligados), e sessões em
//   sábado ou domingo desligados ficam fora dos contadores, como no legado.
// - Contadores: total sem canceladas nem remarcadas; realizadas; realizadas sem evolução;
//   pendentes de pagamento pela regra do débito (FIN-06).
// - Lista de hoje: até 6 sessões, sem canceladas nem remarcadas, em ordem de início e id, com o
//   estado da evolução (4) e do pagamento (3). Nunca leva texto clínico.
// - PREMISSA: hoje_total conta as mesmas sessões da lista (sem o limite), inclusive em sábado ou
//   domingo desligado; o legado contava só dia habilitado, o que deixava a lista maior que o total.
// O RLS e o filtro por usuario_id mostram só as sessões do profissional (ISO-02).

const FUSO = 'America/Sao_Paulo';

export const rotasInicio = new Hono<AmbienteAutenticado>().get(
  '/inicio',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const { rows } = await sql<{ hoje: string }>`
      select to_char((now() at time zone ${FUSO})::date, 'YYYY-MM-DD') as hoje`.execute(trx);
    const hoje = rows[0]!.hoje;
    const dias = await fimDeSemanaDoPerfil(trx, usuarioId);
    const semana = semanaDeAtendimento(hoje, dias);

    // Sessões da semana (segunda até o último dia habilitado; o domingo é o limite de qualquer
    // semana) com o dia em Brasília, o dia ISO e se têm evolução e pagamento.
    const linhas = await trx
      .selectFrom('sessao_atendimento as s')
      .innerJoin('paciente as p', (j) =>
        j.onRef('p.id', '=', 's.paciente_id').onRef('p.usuario_id', '=', 's.usuario_id'),
      )
      .leftJoin('pagamento as pg', (j) =>
        j.onRef('pg.sessao_id', '=', 's.id').onRef('pg.usuario_id', '=', 's.usuario_id'),
      )
      .leftJoin('evolucao as e', (j) =>
        j.onRef('e.sessao_id', '=', 's.id').onRef('e.usuario_id', '=', 's.usuario_id'),
      )
      .select([
        's.id',
        's.inicio',
        's.fim',
        's.status',
        's.cobravel',
        'p.id as paciente_id',
        'p.nome',
        sql<string>`to_char((s.inicio at time zone ${FUSO})::date, 'YYYY-MM-DD')`.as('dia'),
        sql<number>`extract(isodow from s.inicio at time zone ${FUSO})::int`.as('dia_iso'),
        sql<boolean>`pg.id is not null`.as('pago'),
        sql<boolean>`e.id is not null`.as('tem_evolucao'),
        sql<boolean>`coalesce((e.criado_em at time zone ${FUSO})::date
          = (now() at time zone ${FUSO})::date, false)`.as('evolucao_de_hoje'),
      ])
      .where('s.usuario_id', '=', usuarioId)
      .where(
        sql<boolean>`(s.inicio at time zone ${FUSO})::date between ${semana.inicio}::date
        and (${semana.inicio}::date + 6)`,
      )
      .orderBy('s.inicio')
      .orderBy('s.id')
      .execute();

    const ativa = (status: string) => status !== 'cancelada' && status !== 'remarcada';
    const daSemana = linhas.filter((l) => l.dia <= semana.fim && diaHabilitado(l.dia_iso, dias));
    const realizadas = daSemana.filter((l) => l.status === 'realizada');
    const deHoje = linhas.filter((l) => l.dia === hoje && ativa(l.status));

    const resumo: ResumoInicio = {
      semana: {
        ...semana,
        total: daSemana.filter((l) => ativa(l.status)).length,
        realizadas: realizadas.length,
        pendentes_evolucao: realizadas.filter((l) => !l.tem_evolucao).length,
        pendentes_pagamento: daSemana.filter(
          (l) => estadoPagamento(l.status, l.cobravel, l.pago) === 'pendente',
        ).length,
      },
      hoje: deHoje.slice(0, LIMITE_HOJE).map((l) => ({
        id: l.id,
        inicio: l.inicio.toISOString(),
        fim: l.fim.toISOString(),
        status: l.status,
        paciente: { id: l.paciente_id, nome: l.nome },
        evolucao: estadoEvolucao(l.status, l.tem_evolucao, l.evolucao_de_hoje),
        pagamento: estadoPagamento(l.status, l.cobravel, l.pago),
      })),
      hoje_total: deHoje.length,
      alerta: {
        editavel_hoje_sem_texto: deHoje.filter(
          (l) =>
            estadoEvolucao(l.status, l.tem_evolucao, l.evolucao_de_hoje) ===
            'editavel_hoje_sem_texto',
        ).length,
      },
    };
    return c.json(resumo);
  },
);
