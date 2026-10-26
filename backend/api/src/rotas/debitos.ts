import {
  PROBLEMA_CONSULTA_DEBITOS_INVALIDA,
  PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
  esquemaFiltroDebitos,
} from '@es/contrato/financeiro';
import {
  type SessaoCandidata,
  agruparDebitos,
  pendenciasDoPaciente,
  valorDaSessao,
} from '@es/dominio/financeiro/debitos';
import { Hono } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { centavos } from '../repositorios/financeiro.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// FIN-06, FIN-07, ISO-02: débitos, rotas autenticadas e só de leitura. Adaptado de DebtsService e
// debts.repository.ts do legado, em centavos (ADR-007). O débito é derivado por consulta, sem
// tabela: as candidatas são as sessões realizada, faltou ou cancelada sem pagamento, e a regra
// final é do domínio (emDebito).
// - GET /api/debitos?status=em_debito|em_dia (ausente = todos): um item por paciente, ativo ou
//   inativo, em ordem de nome sem diferença de caixa e depois id, sem paginação, com
//   `total_pendente` (decisões do usuário de 2026-10-26). Filtro inválido: 400 consulta_invalida.
// - GET /api/debitos/:pacienteId: as sessões pendentes do paciente em ordem de início.
// - Valor da sessão = ajuste da sessão ou preço do paciente (SPEC_DEVIATION da FIN-03, decisão do
//   usuário); sem nenhum, `valor: null`, que conta 0.
// - PREMISSA: a sessão entra no débito sem filtro de data, como no legado.
// - Paciente inexistente, de outro profissional ou com id malformado: 404 (ISO-02).

async function pacientes(trx: Trx, usuarioId: string, pacienteId?: string) {
  let consulta = trx
    .selectFrom('paciente')
    .select(['id', 'nome'])
    .where('usuario_id', '=', usuarioId);
  if (pacienteId !== undefined) consulta = consulta.where('id', '=', pacienteId);
  return consulta
    .orderBy(sql`lower(nome)`)
    .orderBy('id')
    .execute();
}

async function candidatas(
  trx: Trx,
  usuarioId: string,
  pacienteId?: string,
): Promise<SessaoCandidata[]> {
  let consulta = trx
    .selectFrom('sessao_atendimento as s')
    .leftJoin('pagamento as pg', (j) =>
      j.onRef('pg.sessao_id', '=', 's.id').onRef('pg.usuario_id', '=', 's.usuario_id'),
    )
    .leftJoin('preco_sessao as ps', (j) =>
      j.onRef('ps.sessao_id', '=', 's.id').onRef('ps.usuario_id', '=', 's.usuario_id'),
    )
    .leftJoin('preco_paciente as pp', (j) =>
      j.onRef('pp.paciente_id', '=', 's.paciente_id').onRef('pp.usuario_id', '=', 's.usuario_id'),
    )
    .select([
      's.id',
      's.paciente_id',
      's.inicio',
      's.status',
      's.cobravel',
      'ps.valor_centavos as preco_sessao',
      'pp.valor_centavos as preco_paciente',
    ])
    .where('s.usuario_id', '=', usuarioId)
    .where('pg.id', 'is', null)
    .where('s.status', 'in', ['realizada', 'faltou', 'cancelada']);
  if (pacienteId !== undefined) consulta = consulta.where('s.paciente_id', '=', pacienteId);
  const linhas = await consulta.orderBy('s.inicio').orderBy('s.id').execute();
  const emCentavos = (v: string | null) => (v === null ? null : centavos(v));
  return linhas.map((l) => ({
    sessao_id: l.id,
    paciente_id: l.paciente_id,
    inicio: l.inicio.toISOString(),
    status: l.status,
    cobravel: l.cobravel,
    valor: valorDaSessao(emCentavos(l.preco_sessao), emCentavos(l.preco_paciente)),
  }));
}

export const rotasDebitos = new Hono<AmbienteAutenticado>()
  .get('/debitos', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const filtro = esquemaFiltroDebitos.safeParse(c.req.query());
    if (!filtro.success) return responderProblema(c, PROBLEMA_CONSULTA_DEBITOS_INVALIDA);
    return c.json(
      agruparDebitos(
        await pacientes(trx, usuarioId),
        await candidatas(trx, usuarioId),
        filtro.data.status,
      ),
    );
  })
  .get('/debitos/:pacienteId', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const pacienteId = c.req.param('pacienteId');
    if (!idValido(pacienteId)) return responderProblema(c, PROBLEMA_FINANCEIRO_NAO_ENCONTRADO);
    const [paciente] = await pacientes(trx, usuarioId, pacienteId);
    if (!paciente) return responderProblema(c, PROBLEMA_FINANCEIRO_NAO_ENCONTRADO);
    return c.json(pendenciasDoPaciente(paciente, await candidatas(trx, usuarioId, pacienteId)));
  });
