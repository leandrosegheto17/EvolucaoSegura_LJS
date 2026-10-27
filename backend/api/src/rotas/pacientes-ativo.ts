import { PROBLEMA_PACIENTE_NAO_ENCONTRADO } from '@es/contrato/pacientes';
import { type Context, Hono } from 'hono';
import { sql } from 'kysely';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { respostaLimitePlano, temVagaDePaciente } from '../middleware/plano.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { COLUNAS_PACIENTE, idValido, paraPaciente } from '../repositorios/pacientes.ts';

// PAC-03, PAC-04: POST /api/pacientes/:id/inativar e /reativar, rotas autenticadas adaptadas do
// PatientStatusService do legado (deactivate/reactivate). Só o flag `ativo` muda, com row_version
// e atualizado_em: prontuário, TCLE e sessões futuras ficam como estão (D-24), e a app nem tem
// grant de UPDATE em outra coluna do paciente. A troca audita paciente.inativado ou
// paciente.reativado (só o nome do campo), na mesma transação. Pedir o estado atual responde 200
// com o paciente, sem subir row_version nem auditar. Paciente de outro profissional (RLS),
// inexistente ou com id malformado: o mesmo 404 (ISO-02).
// PLANO-03: reativar no Free com 5 ou mais ativos responde 403 LIMITE_PLANO, depois do 404 e do
// "já está ativo" (PAC-04 responde sucesso sem mudança), para não mudar essas respostas.

const trocarAtivo = (ativo: boolean) =>
  async function (c: Context<AmbienteAutenticado>): Promise<Response> {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id') ?? '';
    const atual = idValido(id)
      ? await trx
          .selectFrom('paciente')
          .select(COLUNAS_PACIENTE)
          .where('usuario_id', '=', usuarioId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst()
      : undefined;
    if (!atual)
      return c.json(PROBLEMA_PACIENTE_NAO_ENCONTRADO, 404, {
        'Content-Type': 'application/problem+json',
      });
    if (atual.ativo === ativo) return c.json(paraPaciente(atual));
    if (ativo && !(await temVagaDePaciente(trx, usuarioId))) return respostaLimitePlano(c);

    const alterado = await trx
      .updateTable('paciente')
      .set({ ativo, row_version: sql<number>`row_version + 1`, atualizado_em: sql<Date>`now()` })
      .where('id', '=', atual.id)
      .returning(COLUNAS_PACIENTE)
      .executeTakeFirstOrThrow();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: ativo ? 'paciente.reativado' : 'paciente.inativado',
      alvoTipo: 'paciente',
      alvoId: atual.id,
      camposAlterados: ['ativo'],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(paraPaciente(alterado));
  };

export const rotasPacientesAtivo = new Hono<AmbienteAutenticado>()
  .post('/pacientes/:id/inativar', ...autenticada, trocarAtivo(false))
  .post('/pacientes/:id/reativar', ...autenticada, trocarAtivo(true));
