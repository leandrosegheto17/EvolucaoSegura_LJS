import {
  PROBLEMA_EVOLUCAO_EXISTENTE,
  PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
  esquemaEvolucaoEntrada,
  esquemaListagemEvolucoes,
} from '@es/contrato/clinico';
import { PROBLEMA_CONSULTA_INVALIDA } from '@es/contrato/pacientes';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import {
  evolucoesDoPaciente,
  linhaEvolucao,
  paraEvolucao,
  paraEvolucoes,
} from '../repositorios/evolucoes.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// EVO-01, EVO-02, EVO-03, ISO-02: POST /api/evolucoes e GET /api/pacientes/:id/evolucoes, rotas
// autenticadas. Adaptado de EvolutionService.create e .list do legado.
// - Paciente ou sessão inexistente, de outro profissional ou com id malformado: 404. Sessão de
//   outro paciente do mesmo profissional também é 404 (como no legado).
// - POST: texto não vazio depois de aparar, até 100.000, guardado como veio (contrato).
//   Paciente inativo pode ter evolução. Uma por sessão: a segunda responde 409
//   EVOLUTION_EXISTS, também na corrida (ON CONFLICT no índice único parcial). A sessão é
//   travada FOR UPDATE; se estava `agendada`, vira `realizada` na mesma transação (EVO-03),
//   sem mudar o cobravel. Em outro status, a evolução é aceita e a sessão não muda (decisão do
//   usuário em 2026-10-26, como no legado).
// - GET: mais recentes primeiro, limit de 1 a 100 (padrão 50) e offset; inválidos = 400.
// - Auditoria só com ids, nunca o texto: evolucao.criada e, se a sessão mudou,
//   sessao.status_alterado.

const origem = (c: { req: { header: (nome: string) => string | undefined } }) => ({
  ip: c.req.header('CF-Connecting-IP') ?? null,
  userAgent: c.req.header('User-Agent') ?? null,
});

export const rotasEvolucoes = new Hono<AmbienteAutenticado>()
  .get('/pacientes/:id/evolucoes', ...autenticada, async (c) => {
    const { trx } = c.var;
    const pacienteId = c.req.param('id');
    if (!idValido(pacienteId)) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    const consulta = esquemaListagemEvolucoes.safeParse(c.req.query());
    if (!consulta.success) return responderProblema(c, PROBLEMA_CONSULTA_INVALIDA);
    const paciente = await trx
      .selectFrom('paciente')
      .select('id')
      .where('id', '=', pacienteId)
      .executeTakeFirst();
    if (!paciente) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    const { limit, offset } = consulta.data;
    const linhas = await evolucoesDoPaciente(trx, pacienteId, limit, offset);
    return c.json({ items: await paraEvolucoes(trx, linhas), limit, offset });
  })
  .post('/evolucoes', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const leitura = await lerCorpo(c, esquemaEvolucaoEntrada);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const paciente = await trx
      .selectFrom('paciente')
      .select('id')
      .where('id', '=', dados.paciente_id)
      .executeTakeFirst();
    if (!paciente) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    const sessao = dados.sessao_id
      ? await trx
          .selectFrom('sessao_atendimento')
          .select(['id', 'status'])
          .where('id', '=', dados.sessao_id)
          .where('paciente_id', '=', dados.paciente_id)
          .forUpdate()
          .executeTakeFirst()
      : undefined;
    if (dados.sessao_id && !sessao) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);

    const criada = await trx
      .insertInto('evolucao')
      .values({
        usuario_id: usuarioId,
        paciente_id: dados.paciente_id,
        sessao_id: dados.sessao_id,
        texto: dados.texto,
      })
      .onConflict((oc) => oc.column('sessao_id').where('sessao_id', 'is not', null).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!criada) return responderProblema(c, PROBLEMA_EVOLUCAO_EXISTENTE);
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'evolucao.criada',
      alvoTipo: 'evolucao',
      alvoId: criada.id,
      ...origem(c),
    });

    if (sessao?.status === 'agendada') {
      await trx
        .updateTable('sessao_atendimento')
        .set({
          status: 'realizada',
          row_version: sql<number>`row_version + 1`,
          atualizado_em: sql<Date>`now()`,
        })
        .where('id', '=', sessao.id)
        .execute();
      await registrarAuditoria(trx, {
        usuarioId,
        ator: usuarioId,
        acao: 'sessao.status_alterado',
        alvoTipo: 'agendamento',
        alvoId: sessao.id,
        camposAlterados: ['status'],
        ...origem(c),
      });
    }

    const linha = await linhaEvolucao(trx, criada.id);
    return c.json(await paraEvolucao(trx, linha!), 201);
  });
