import {
  PROBLEMA_SESSAO_COM_REGISTROS,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  PROBLEMA_VERSAO_DIVERGENTE,
  esquemaSessaoEdicao,
} from '@es/contrato/agenda';
import { STATUS_QUE_OCUPAM } from '@es/dominio/agenda/conflito';
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

// AGE-11, AGE-04, AGE-06, AGE-12, AGE-17: PUT /api/sessoes/:id, rota autenticada que altera
// horário, link, paciente e cobravel. Adaptado de SessionsService.update do legado.
// - Sessão inexistente, de outro profissional ou com id malformado: 404 (ISO-02).
// - row_version diferente do atual: 409 versao_divergente, sem gravar (AGE-11).
// - Mover (início ou fim mudam) reaplica as três checagens: paciente ativo (o novo ou o atual),
//   dia habilitado do novo início e conflito, este só se a sessão ocupa o horário (agendada,
//   realizada ou faltou), ignorando a própria. Trocar o paciente confere o novo paciente.
//   PREMISSA: o legado só checava o dia quando o dia da semana mudava; aqui todo novo início é
//   checado, como diz o AGE-06 ("movida para sábado ou domingo desligado").
// - Trocar o paciente de sessão com evolução ou pagamento: 422 SESSION_HAS_RECORDS (T113).
// - Sem mudança de fato: 200 com a sessão, sem subir row_version nem auditar.
// - Audita sessao.editada com os nomes dos campos (e conflito_confirmado, como no legado).
// Nenhum caminho apaga a sessão (AGE-17): não existe rota DELETE.

const CAMPOS_EDITAVEIS = ['paciente_id', 'inicio', 'fim', 'link', 'cobravel'] as const;

export const rotasSessoesEditar = new Hono<AmbienteAutenticado>().put(
  '/sessoes/:id',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblemaAgenda(c, PROBLEMA_SESSAO_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaSessaoEdicao);
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

    const inicio = new Date(dados.inicio);
    const fim = new Date(dados.fim);
    const novo = {
      paciente_id: dados.paciente_id ?? atual.paciente_id,
      inicio: inicio.getTime(),
      fim: fim.getTime(),
      link: dados.link,
      cobravel: dados.cobravel ?? atual.cobravel,
    };
    const antes = {
      paciente_id: atual.paciente_id,
      inicio: atual.inicio.getTime(),
      fim: atual.fim.getTime(),
      link: atual.link,
      cobravel: atual.cobravel,
    };
    const campos = CAMPOS_EDITAVEIS.filter((campo) => novo[campo] !== antes[campo]);
    if (campos.length === 0) return c.json(paraSessao(atual));
    // AGE-08 (T113, decisão do usuário de 2026-10-26): a evolução guarda o paciente, então a
    // sessão com evolução ou pagamento não troca de paciente; horário, link e cobravel seguem livres.
    if (campos.includes('paciente_id') && (await sessaoTemRegistros(trx, usuarioId, atual.id)))
      return responderProblemaAgenda(c, PROBLEMA_SESSAO_COM_REGISTROS);

    const moveu = campos.includes('inicio') || campos.includes('fim');
    const horario = await verificarHorario(trx, {
      usuarioId,
      ...(moveu || campos.includes('paciente_id') ? { pacienteId: novo.paciente_id } : {}),
      inicio,
      fim,
      confirmarConflito: dados.confirmar_conflito,
      checarDia: campos.includes('inicio'),
      checarConflito: moveu && STATUS_QUE_OCUPAM.includes(atual.status),
      ignorarId: atual.id,
    });
    if (!horario.ok) return responderProblemaAgenda(c, horario.problema);

    const alterada = await trx
      .updateTable('sessao_atendimento')
      .set({
        paciente_id: novo.paciente_id,
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        link: novo.link,
        cobravel: novo.cobravel,
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
      acao: 'sessao.editada',
      alvoTipo: 'agendamento',
      alvoId: atual.id,
      camposAlterados:
        horario.conflitos.length > 0 ? [...campos, 'conflito_confirmado'] : [...campos],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(paraSessao(alterada));
  },
);
