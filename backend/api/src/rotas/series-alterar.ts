import {
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_DIA_INDISPONIVEL,
  PROBLEMA_SERIE_CANCELADA,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  PROBLEMA_VERSAO_DIVERGENTE,
  esquemaSerieEdicao,
} from '@es/contrato/agenda';
import type { Problema } from '@es/contrato/identidade';
import { diaHabilitadoNoInstante } from '@es/dominio/agenda/conflito';
import { deslocarAPartirDe } from '@es/dominio/agenda/serie';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { COLUNAS_SERIE, ocorrenciasDaSerie, paraSerie } from '../repositorios/series.ts';
import {
  conflitosDoHorario,
  fimDeSemanaDoPerfil,
  paraSessao,
  responderProblemaAgenda,
  verificarHorario,
} from '../repositorios/sessoes.ts';

// AGE-15, AGE-04, AGE-05, AGE-06, AGE-11, AGE-12, AGE-17: PUT /api/series/:id, rota autenticada
// que desloca as ocorrências `agendada` da série a partir de uma data. Adaptado de
// SeriesService.update do legado; decisões do usuário em 2026-10-26:
// - Série inexistente, de outro profissional ou id malformado: 404 (ISO-02).
// - row_version opcional; se vier diferente do atual, 409 versao_divergente, sem gravar.
// - Série cancelada: 422 SERIES_CANCELLED, sem gravar.
// - a_partir_de opcional (padrão: agora). Só as `agendada` com início nele ou depois se movem:
//   a primeira vai para o novo início e fim; as demais andam a mesma diferença, com a nova
//   duração, o novo link (ausente = sem link) e o cobravel pedido (ausente = como está).
// - Nenhuma agendada a partir da data: 200 com tudo como está, sem subir versão nem auditar.
//   PREMISSA (como na T80): havendo abertas mas nenhuma mudança de fato, também 200 sem gravar.
// - Paciente ativo e dia habilitado conferidos em toda ocorrência cujo início muda (como na T80);
//   conflito conferido em toda ocorrência que se move, ignorando só as ocorrências do próprio
//   deslocamento (409 SCHEDULE_CONFLICT com `colisoes`, ou grava com confirmar_conflito: true).
// - Tudo ou nada: as checagens vêm antes de qualquer gravação, na transação da requisição.
// - Audita serie.editada (alvo agendamento) com os campos alterados. Nada é apagado (AGE-17).

const CAMPOS = ['inicio', 'fim', 'link', 'cobravel'] as const;

export const rotasSeriesAlterar = new Hono<AmbienteAutenticado>().put(
  '/series/:id',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblemaAgenda(c, PROBLEMA_SESSAO_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaSerieEdicao);
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
    if (dados.row_version !== undefined && dados.row_version !== serie.row_version)
      return responderProblemaAgenda(c, PROBLEMA_VERSAO_DIVERGENTE);
    if (serie.cancelada) return responderProblemaAgenda(c, PROBLEMA_SERIE_CANCELADA);

    const ocorrencias = await ocorrenciasDaSerie(trx, usuarioId, serie.id);
    const semMudanca = () =>
      c.json({ serie: paraSerie(serie), sessoes: ocorrencias.map(paraSessao) });
    const porId = new Map(ocorrencias.map((o, i) => [o.id, { linha: o, posicao: i + 1 }]));
    const plano = deslocarAPartirDe(
      ocorrencias,
      dados.a_partir_de ? new Date(dados.a_partir_de) : new Date(),
      { inicio: new Date(dados.inicio), fim: new Date(dados.fim) },
    ).map((item) => {
      const { linha, posicao } = porId.get(item.id)!;
      const novo = {
        inicio: item.inicio.getTime(),
        fim: item.fim.getTime(),
        link: dados.link,
        cobravel: dados.cobravel ?? linha.cobravel,
      };
      const antes = {
        inicio: linha.inicio.getTime(),
        fim: linha.fim.getTime(),
        link: linha.link,
        cobravel: linha.cobravel,
      };
      const campos = CAMPOS.filter((campo) => novo[campo] !== antes[campo]);
      return { ...item, posicao, cobravel: novo.cobravel, campos };
    });
    const alterados = plano.filter((p) => p.campos.length > 0);
    if (alterados.length === 0) return semMudanca();

    const movidos = alterados.filter(
      (p) => p.campos.includes('inicio') || p.campos.includes('fim'),
    );
    const mudamInicio = movidos.filter((p) => p.campos.includes('inicio'));
    if (mudamInicio.length > 0) {
      const paciente = await verificarHorario(trx, {
        usuarioId,
        pacienteId: serie.paciente_id,
        inicio: mudamInicio[0]!.inicio,
        fim: mudamInicio[0]!.fim,
        confirmarConflito: dados.confirmar_conflito,
        checarDia: false,
        checarConflito: false,
      });
      if (!paciente.ok) return responderProblemaAgenda(c, paciente.problema);
      const fimDeSemana = await fimDeSemanaDoPerfil(trx, usuarioId);
      if (mudamInicio.some((p) => !diaHabilitadoNoInstante(p.inicio, fimDeSemana)))
        return responderProblemaAgenda(c, PROBLEMA_DIA_INDISPONIVEL);
    }

    const doDeslocamento = new Set(plano.map((p) => p.id));
    const colisoes: NonNullable<Problema['colisoes']> = [];
    for (const p of movidos)
      for (const sessaoId of await conflitosDoHorario(trx, usuarioId, p))
        if (!doDeslocamento.has(sessaoId))
          colisoes.push({
            ocorrencia: p.posicao,
            inicio: p.inicio.toISOString(),
            sessao_id: sessaoId,
          });
    if (colisoes.length > 0 && dados.confirmar_conflito !== true)
      return responderProblemaAgenda(c, { ...PROBLEMA_CONFLITO_HORARIO, colisoes });

    for (const p of alterados)
      await trx
        .updateTable('sessao_atendimento')
        .set({
          inicio: p.inicio.toISOString(),
          fim: p.fim.toISOString(),
          link: dados.link,
          cobravel: p.cobravel,
          row_version: sql<number>`row_version + 1`,
          atualizado_em: sql<Date>`now()`,
        })
        .where('usuario_id', '=', usuarioId)
        .where('id', '=', p.id)
        .execute();
    const atualizada = await trx
      .updateTable('serie_recorrencia')
      .set({ row_version: sql<number>`row_version + 1`, atualizado_em: sql<Date>`now()` })
      .where('usuario_id', '=', usuarioId)
      .where('id', '=', serie.id)
      .returning(COLUNAS_SERIE)
      .executeTakeFirstOrThrow();
    const campos = CAMPOS.filter((campo) => alterados.some((p) => p.campos.includes(campo)));
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'serie.editada',
      alvoTipo: 'agendamento',
      alvoId: serie.id,
      camposAlterados: colisoes.length > 0 ? [...campos, 'conflito_confirmado'] : [...campos],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    const sessoes = await ocorrenciasDaSerie(trx, usuarioId, serie.id);
    return c.json({ serie: paraSerie(atualizada), sessoes: sessoes.map(paraSessao) });
  },
);
