import {
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_DIA_INDISPONIVEL,
  esquemaSerieEntrada,
} from '@es/contrato/agenda';
import type { Problema } from '@es/contrato/identidade';
import { diaHabilitadoNoInstante } from '@es/dominio/agenda/conflito';
import { gerarOcorrencias } from '@es/dominio/agenda/serie';
import { Hono } from 'hono';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { COLUNAS_SERIE, paraSerie } from '../repositorios/series.ts';
import {
  COLUNAS_SESSAO,
  conflitosDoHorario,
  fimDeSemanaDoPerfil,
  paraSessao,
  responderProblemaAgenda,
  verificarHorario,
} from '../repositorios/sessoes.ts';

// AGE-13, AGE-14, AGE-04, AGE-05, AGE-06, AGE-12: POST /api/series, rota autenticada que cria a
// série inteira ou nenhuma ocorrência. Adaptado de SeriesService.create do legado.
// - Corpo pelo contrato (2 a 52 ocorrências, semanal ou quinzenal; 422 `validacao`).
// - Checagens na ordem do legado, todas antes de gravar: paciente (404 de outro profissional;
//   422 PATIENT_INACTIVE), dia habilitado de cada ocorrência (422 WEEKDAY_UNAVAILABLE) e conflito
//   de cada ocorrência com as sessões que ocupam o horário: sem confirmar_conflito, 409
//   SCHEDULE_CONFLICT com todas as colisões em `colisoes` (AGE-14).
// - Todas as ocorrências nascem agendadas, com a mesma duração, o mesmo link e cobravel (padrão
//   falso, AGE-10; no legado era verdadeiro).
// - Audita serie.criada (alvo agendamento), com `conflito_confirmado` quando confirmado.

export const rotasSeries = new Hono<AmbienteAutenticado>().post(
  '/series',
  ...autenticada,
  async (c) => {
    const leitura = await lerCorpo(c, esquemaSerieEntrada);
    if (!leitura.ok) return leitura.resposta;
    const { trx, usuarioId } = c.var;
    const dados = leitura.dados;
    const ocorrencias = gerarOcorrencias(
      { inicio: new Date(dados.inicio), fim: new Date(dados.fim) },
      dados.frequencia,
      dados.ocorrencias,
    );

    const paciente = await verificarHorario(trx, {
      usuarioId,
      pacienteId: dados.paciente_id,
      inicio: ocorrencias[0]!.inicio,
      fim: ocorrencias[0]!.fim,
      confirmarConflito: dados.confirmar_conflito,
      checarDia: false,
      checarConflito: false,
    });
    if (!paciente.ok) return responderProblemaAgenda(c, paciente.problema);

    const fimDeSemana = await fimDeSemanaDoPerfil(trx, usuarioId);
    if (ocorrencias.some((o) => !diaHabilitadoNoInstante(o.inicio, fimDeSemana)))
      return responderProblemaAgenda(c, PROBLEMA_DIA_INDISPONIVEL);

    const colisoes: NonNullable<Problema['colisoes']> = [];
    for (const [indice, ocorrencia] of ocorrencias.entries())
      for (const sessaoId of await conflitosDoHorario(trx, usuarioId, ocorrencia))
        colisoes.push({
          ocorrencia: indice + 1,
          inicio: ocorrencia.inicio.toISOString(),
          sessao_id: sessaoId,
        });
    if (colisoes.length > 0 && dados.confirmar_conflito !== true)
      return responderProblemaAgenda(c, { ...PROBLEMA_CONFLITO_HORARIO, colisoes });

    const serie = await trx
      .insertInto('serie_recorrencia')
      .values({
        usuario_id: usuarioId,
        paciente_id: dados.paciente_id,
        frequencia: dados.frequencia,
        ocorrencias: dados.ocorrencias,
      })
      .returning(COLUNAS_SERIE)
      .executeTakeFirstOrThrow();
    const sessoes = await trx
      .insertInto('sessao_atendimento')
      .values(
        ocorrencias.map((o) => ({
          usuario_id: usuarioId,
          paciente_id: dados.paciente_id,
          serie_id: serie.id,
          inicio: o.inicio.toISOString(),
          fim: o.fim.toISOString(),
          link: dados.link,
          ...(dados.cobravel === undefined ? {} : { cobravel: dados.cobravel }),
        })),
      )
      .returning(COLUNAS_SESSAO)
      .execute();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'serie.criada',
      alvoTipo: 'agendamento',
      alvoId: serie.id,
      camposAlterados: colisoes.length > 0 ? ['conflito_confirmado'] : [],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    sessoes.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
    return c.json({ serie: paraSerie(serie), sessoes: sessoes.map(paraSessao) }, 201);
  },
);
