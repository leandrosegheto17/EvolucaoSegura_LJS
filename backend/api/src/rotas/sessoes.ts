import { esquemaSessaoEntrada } from '@es/contrato/agenda';
import { Hono } from 'hono';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import {
  COLUNAS_SESSAO,
  paraSessao,
  responderProblemaAgenda,
  verificarHorario,
} from '../repositorios/sessoes.ts';

// AGE-01, AGE-04, AGE-05, AGE-06, AGE-12: POST /api/sessoes, rota autenticada (sessão, CSRF,
// transação do profissional) que cria uma sessão avulsa. Adaptado de SessionsService.create do
// legado.
// - Corpo pelo contrato (422 `validacao`).
// - Paciente inexistente ou de outro profissional: 404 (ISO-02); inativo: 422 PATIENT_INACTIVE.
// - Sábado ou domingo desligado no perfil (dia em America/Sao_Paulo): 422 WEEKDAY_UNAVAILABLE.
// - Sobreposição com agendada, realizada ou faltou: 409 SCHEDULE_CONFLICT; com
//   confirmar_conflito: true grava, sem tocar na sessão existente (AGE-05).
// A sessão nasce agendada, com cobravel falso salvo pedido. Audita sessao.criada (alvo
// agendamento), com `conflito_confirmado` quando o conflito foi confirmado, como no legado.

export const rotasSessoes = new Hono<AmbienteAutenticado>().post(
  '/sessoes',
  ...autenticada,
  async (c) => {
    const leitura = await lerCorpo(c, esquemaSessaoEntrada);
    if (!leitura.ok) return leitura.resposta;
    const { trx, usuarioId } = c.var;
    const dados = leitura.dados;

    const horario = await verificarHorario(trx, {
      usuarioId,
      pacienteId: dados.paciente_id,
      inicio: new Date(dados.inicio),
      fim: new Date(dados.fim),
      confirmarConflito: dados.confirmar_conflito,
      checarDia: true,
      checarConflito: true,
    });
    if (!horario.ok) return responderProblemaAgenda(c, horario.problema);

    const linha = await trx
      .insertInto('sessao_atendimento')
      .values({
        usuario_id: usuarioId,
        paciente_id: dados.paciente_id,
        inicio: dados.inicio,
        fim: dados.fim,
        link: dados.link,
        ...(dados.cobravel === undefined ? {} : { cobravel: dados.cobravel }),
      })
      .returning(COLUNAS_SESSAO)
      .executeTakeFirstOrThrow();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'sessao.criada',
      alvoTipo: 'agendamento',
      alvoId: linha.id,
      camposAlterados: horario.conflitos.length > 0 ? ['conflito_confirmado'] : [],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(paraSessao(linha), 201);
  },
);
