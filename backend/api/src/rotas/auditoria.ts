import {
  ACOES_DO_FILTRO_AUDITORIA,
  ACOES_FORA_DA_TRILHA,
  type ConsultaAuditoria,
  type EventoTrilha,
  PROBLEMA_AUDITORIA_NAO_ENCONTRADA,
  PROBLEMA_CONSULTA_AUDITORIA_INVALIDA,
  type PaginaAuditoria,
  esquemaConsultaAuditoria,
} from '@es/contrato/auditoria';
import { Hono } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { pacienteExiste } from '../repositorios/financeiro.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// AUD-03, ISO-02: GET /api/auditoria, só de leitura. Adaptado de account.controller.ts,
// patient-history.controller.ts e audit-query.repository.ts do legado.
// - Sem paciente_id: "Trilha da minha conta", todos os eventos do profissional.
// - Com paciente_id: "Histórico do paciente", os eventos cujo alvo é o paciente ou um registro
//   dele (evolução, anamnese, sessão ou série, pagamento de sessão dele), como no legado sem o
//   relatório, que não existe aqui.
// - Sempre sem paciente.consultado; filtro todos, retificacoes ou exportacoes no servidor.
// - Do mais novo ao mais antigo (id decrescente); pede limit + 1 para saber se há outra página.
// - Consulta inválida: 400 consulta_invalida. Paciente inexistente, de outro profissional ou com
//   id malformado: 404 (ISO-02). Além do RLS, toda consulta filtra por usuario_id.

async function eventos(
  trx: Trx,
  usuarioId: string,
  consulta: ConsultaAuditoria,
): Promise<EventoTrilha[]> {
  const { filtro, cursor, limit, paciente_id: pacienteId } = consulta;
  let busca = trx
    .selectFrom('audit_log as a')
    .select([
      sql<string>`a.id::text`.as('id'),
      'a.acao',
      'a.alvo_tipo',
      'a.alvo_id',
      'a.campos_alterados',
      'a.origem_ip',
      'a.origem_ua',
      'a.criado_em',
    ])
    .where('a.usuario_id', '=', usuarioId)
    .where('a.acao', 'not in', ACOES_FORA_DA_TRILHA);
  if (filtro !== 'todos') busca = busca.where('a.acao', 'in', ACOES_DO_FILTRO_AUDITORIA[filtro]);
  if (cursor !== null) busca = busca.where(sql<boolean>`a.id < ${cursor}::bigint`);
  if (pacienteId !== null)
    busca = busca.where('a.alvo_id', 'is not', null).where((eb) => {
      const doPaciente = (
        tabela: 'evolucao' | 'anamnese' | 'sessao_atendimento' | 'serie_recorrencia',
      ) =>
        eb
          .selectFrom(tabela)
          .select('id')
          .where('paciente_id', '=', pacienteId)
          .where('usuario_id', '=', usuarioId);
      return eb.or([
        eb.and([eb('a.alvo_tipo', '=', 'paciente'), eb('a.alvo_id', '=', pacienteId)]),
        eb.and([eb('a.alvo_tipo', '=', 'evolucao'), eb('a.alvo_id', 'in', doPaciente('evolucao'))]),
        eb.and([eb('a.alvo_tipo', '=', 'anamnese'), eb('a.alvo_id', 'in', doPaciente('anamnese'))]),
        eb.and([
          eb('a.alvo_tipo', '=', 'agendamento'),
          eb.or([
            eb('a.alvo_id', 'in', doPaciente('sessao_atendimento')),
            eb('a.alvo_id', 'in', doPaciente('serie_recorrencia')),
          ]),
        ]),
        eb.and([
          eb('a.alvo_tipo', '=', 'pagamento'),
          eb(
            'a.alvo_id',
            'in',
            eb
              .selectFrom('pagamento as p')
              .innerJoin('sessao_atendimento as s', (j) =>
                j.onRef('s.id', '=', 'p.sessao_id').onRef('s.usuario_id', '=', 'p.usuario_id'),
              )
              .select('p.id')
              .where('s.paciente_id', '=', pacienteId)
              .where('p.usuario_id', '=', usuarioId),
          ),
        ]),
      ]);
    });
  const linhas = await busca
    .orderBy('a.id', 'desc')
    .limit(limit + 1)
    .execute();
  return linhas.map(({ criado_em, ...linha }) => ({
    ...linha,
    ocorrido_em: criado_em.toISOString(),
  }));
}

export const rotasAuditoria = new Hono<AmbienteAutenticado>().get(
  '/auditoria',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const consulta = esquemaConsultaAuditoria.safeParse(c.req.query());
    if (!consulta.success) return responderProblema(c, PROBLEMA_CONSULTA_AUDITORIA_INVALIDA);
    const leitura = consulta.data;
    const pacienteId = leitura.paciente_id;
    if (
      pacienteId !== null &&
      (!idValido(pacienteId) || !(await pacienteExiste(trx, usuarioId, pacienteId)))
    )
      return responderProblema(c, PROBLEMA_AUDITORIA_NAO_ENCONTRADA);
    const linhas = await eventos(trx, usuarioId, leitura);
    const items = linhas.slice(0, leitura.limit);
    const pagina: PaginaAuditoria = {
      items,
      proximo_cursor: linhas.length > leitura.limit ? items[items.length - 1]!.id : null,
    };
    return c.json(pagina);
  },
);
