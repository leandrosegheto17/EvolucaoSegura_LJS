import {
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  PROBLEMA_VERSAO_DIVERGENTE,
  esquemaSerieCancelamento,
} from '@es/contrato/agenda';
import { abertasAPartirDe } from '@es/dominio/agenda/serie';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { COLUNAS_SERIE, ocorrenciasDaSerie, paraSerie } from '../repositorios/series.ts';
import { paraSessao, responderProblemaAgenda } from '../repositorios/sessoes.ts';

// AGE-16, AGE-17, AGE-10: POST /api/series/:id/cancelar, rota autenticada que marca a série
// como cancelada e as ocorrências `agendada` com início na data ou depois como `cancelada`.
// Adaptado de SeriesService.cancel do legado; decisões do usuário em 2026-10-26:
// - Série inexistente, de outro profissional ou id malformado: 404 (ISO-02).
// - Já cancelada: 200 com tudo como está (idempotente), mesmo com row_version antigo.
// - row_version opcional; se vier diferente do atual, 409 versao_divergente, sem gravar.
// - a_partir_de opcional (padrão: agora). Anteriores à data, realizadas e faltas ficam intactas.
// - As ocorrências canceladas ficam com cobravel = false (AGE-10: virar cancelada não cobra; aqui
//   não há "cobrar"). No legado, o cobravel ficava como estava.
// - Nada é apagado (AGE-17): só o flag da série e o status das ocorrências mudam.
// - Audita serie.cancelada (alvo agendamento): `cancelada`, e `status` se alguma ocorrência mudou.

export const rotasSeriesCancelar = new Hono<AmbienteAutenticado>().post(
  '/series/:id/cancelar',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblemaAgenda(c, PROBLEMA_SESSAO_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaSerieCancelamento);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const serie = await trx
      .selectFrom('serie_recorrencia')
      .select(COLUNAS_SERIE)
      .where('usuario_id', '=', usuarioId)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!serie) return responderProblemaAgenda(c, PROBLEMA_SESSAO_NAO_ENCONTRADA);
    const ocorrencias = await ocorrenciasDaSerie(trx, usuarioId, serie.id);
    if (serie.cancelada)
      return c.json({ serie: paraSerie(serie), sessoes: ocorrencias.map(paraSessao) });
    if (dados.row_version !== undefined && dados.row_version !== serie.row_version)
      return responderProblemaAgenda(c, PROBLEMA_VERSAO_DIVERGENTE);

    const abertas = abertasAPartirDe(
      ocorrencias,
      dados.a_partir_de ? new Date(dados.a_partir_de) : new Date(),
    );
    if (abertas.length > 0)
      await trx
        .updateTable('sessao_atendimento')
        .set({
          status: 'cancelada',
          cobravel: false,
          row_version: sql<number>`row_version + 1`,
          atualizado_em: sql<Date>`now()`,
        })
        .where('usuario_id', '=', usuarioId)
        .where(
          'id',
          'in',
          abertas.map((o) => o.id),
        )
        .where('status', '=', 'agendada')
        .execute();
    const cancelada = await trx
      .updateTable('serie_recorrencia')
      .set({
        cancelada: true,
        row_version: sql<number>`row_version + 1`,
        atualizado_em: sql<Date>`now()`,
      })
      .where('usuario_id', '=', usuarioId)
      .where('id', '=', serie.id)
      .returning(COLUNAS_SERIE)
      .executeTakeFirstOrThrow();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'serie.cancelada',
      alvoTipo: 'agendamento',
      alvoId: serie.id,
      camposAlterados: abertas.length > 0 ? ['cancelada', 'status'] : ['cancelada'],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    const sessoes = await ocorrenciasDaSerie(trx, usuarioId, serie.id);
    return c.json({ serie: paraSerie(cancelada), sessoes: sessoes.map(paraSessao) });
  },
);
