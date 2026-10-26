import { PROBLEMA_PACIENTE_NAO_ENCONTRADO } from '@es/contrato/pacientes';
import { Hono } from 'hono';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { COLUNAS_PACIENTE, idValido, paraPaciente } from '../repositorios/pacientes.ts';

// PAC-06: GET /api/pacientes/:id abre a ficha do paciente, rota autenticada adaptada do
// PatientsService.get do legado. Cada abertura audita paciente.consultado (alvo paciente, sem
// campos nem conteúdo) na mesma transação: se a auditoria falhar, a leitura falha junto.
// Paciente de outro profissional (RLS), inexistente ou com id malformado: o mesmo 404, sem
// auditar (ISO-02). A listagem não audita.

export const rotasPacienteFicha = new Hono<AmbienteAutenticado>().get(
  '/pacientes/:id',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    const linha = idValido(id)
      ? await trx
          .selectFrom('paciente')
          .select(COLUNAS_PACIENTE)
          .where('usuario_id', '=', usuarioId)
          .where('id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (!linha)
      return c.json(PROBLEMA_PACIENTE_NAO_ENCONTRADO, 404, {
        'Content-Type': 'application/problem+json',
      });
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'paciente.consultado',
      alvoTipo: 'paciente',
      alvoId: linha.id,
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(paraPaciente(linha));
  },
);
