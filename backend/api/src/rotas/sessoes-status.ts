import {
  PROBLEMA_SESSAO_COM_REGISTROS,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  PROBLEMA_TRANSICAO_INVALIDA,
  PROBLEMA_VERSAO_DIVERGENTE,
  esquemaMudancaStatus,
} from '@es/contrato/agenda';
import { avaliarTransicao, cobravelApos, reabreHorario } from '@es/dominio/agenda/sessao';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { idValido } from '../repositorios/pacientes.ts';
import {
  COLUNAS_SESSAO,
  paraSessao,
  responderProblemaAgenda,
  sessaoTemRegistros,
  verificarHorario,
} from '../repositorios/sessoes.ts';

// AGE-07, AGE-08, AGE-09, AGE-10, AGE-11, AGE-17: POST /api/sessoes/:id/status, rota autenticada.
// Adaptado de SessionsService.setStatus do legado.
// - Sessão inexistente, de outro profissional ou id malformado: 404 (ISO-02).
// - row_version diferente do atual: 409 versao_divergente, sem gravar (AGE-11).
// - Transição fora da matriz: 422 transicao_invalida; realizada -> cancelada com evolução ou
//   pagamento: 422 SESSION_HAS_RECORDS (AGE-08).
// - Cancelada ou remarcada voltando a agendada reaplica dia habilitado e conflito (AGE-09), com
//   confirmar_conflito como na criação.
// - Falta e cancelamento gravam cobravel = false, salvo "cobrar" (cobravel: true) (AGE-10).
// - Mesmo status sem mudar o cobravel: 200 sem subir row_version nem auditar.
// - Audita sessao.status_alterado com os nomes dos campos. Nunca apaga (AGE-17).

export const rotasSessoesStatus = new Hono<AmbienteAutenticado>().post(
  '/sessoes/:id/status',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblemaAgenda(c, PROBLEMA_SESSAO_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaMudancaStatus);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const atual = await trx
      .selectFrom('sessao_atendimento')
      .select(COLUNAS_SESSAO)
      .where('usuario_id', '=', usuarioId)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!atual) return responderProblemaAgenda(c, PROBLEMA_SESSAO_NAO_ENCONTRADA);
    if (atual.row_version !== dados.row_version)
      return responderProblemaAgenda(c, PROBLEMA_VERSAO_DIVERGENTE);

    // AGE-08 (T113): só consulta os registros quando a guarda importa.
    const registros =
      atual.status === 'realizada' && dados.status === 'cancelada'
        ? await sessaoTemRegistros(trx, usuarioId, atual.id)
        : false;
    const resultado = avaliarTransicao(atual.status, dados.status, registros);
    if (resultado === 'transicao_invalida')
      return responderProblemaAgenda(c, PROBLEMA_TRANSICAO_INVALIDA);
    if (resultado === 'SESSION_HAS_RECORDS')
      return responderProblemaAgenda(c, PROBLEMA_SESSAO_COM_REGISTROS);

    const cobravel = cobravelApos(atual.status, dados.status, dados.cobravel, atual.cobravel);
    const campos = [
      ...(dados.status !== atual.status ? ['status'] : []),
      ...(cobravel !== atual.cobravel ? ['cobravel'] : []),
    ];
    if (campos.length === 0) return c.json(paraSessao(atual));

    let conflitos: string[] = [];
    if (reabreHorario(atual.status, dados.status)) {
      const horario = await verificarHorario(trx, {
        usuarioId,
        inicio: atual.inicio,
        fim: atual.fim,
        confirmarConflito: dados.confirmar_conflito,
        checarDia: true,
        checarConflito: true,
        ignorarId: atual.id,
      });
      if (!horario.ok) return responderProblemaAgenda(c, horario.problema);
      conflitos = horario.conflitos;
    }

    const alterada = await trx
      .updateTable('sessao_atendimento')
      .set({
        status: dados.status,
        cobravel,
        row_version: sql<number>`row_version + 1`,
        atualizado_em: sql<Date>`now()`,
      })
      .where('id', '=', atual.id)
      .where('row_version', '=', dados.row_version)
      .returning(COLUNAS_SESSAO)
      .executeTakeFirstOrThrow();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'sessao.status_alterado',
      alvoTipo: 'agendamento',
      alvoId: atual.id,
      camposAlterados: conflitos.length > 0 ? [...campos, 'conflito_confirmado'] : campos,
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(paraSessao(alterada));
  },
);
