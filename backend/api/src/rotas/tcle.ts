import {
  PROBLEMA_PACIENTE_NAO_ENCONTRADO,
  type Tcle,
  esquemaTcleEntrada,
} from '@es/contrato/pacientes';
import { type Context, Hono } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { idValido } from '../repositorios/pacientes.ts';

// PAC-05: GET e POST /api/pacientes/:id/tcle, rotas autenticadas adaptadas do ConsentsController
// do legado. O TCLE é só de inclusão: não há PUT, PATCH nem DELETE (caem no 404 de rota
// inexistente), a app só tem SELECT e INSERT na tabela e um trigger barra UPDATE e DELETE
// (migration 0006). Paciente de outro profissional (RLS), inexistente ou com id malformado: o
// mesmo 404, antes de validar o corpo (ISO-02). Corpo inválido: 422 validacao.
// A lista vem do mais recente para o mais antigo (data, depois registro), como no legado.

const COLUNAS_TCLE = [
  'id',
  'finalidade',
  sql<string>`to_char(data_consentimento, 'YYYY-MM-DD')`.as('data'),
  'versao_termo as versao',
  'criado_em',
] as const;

const naoEncontrado = (c: Context) =>
  c.json(PROBLEMA_PACIENTE_NAO_ENCONTRADO, 404, { 'Content-Type': 'application/problem+json' });

async function pacienteExiste(trx: Trx, usuarioId: string, id: string): Promise<boolean> {
  if (!idValido(id)) return false;
  const linha = await trx
    .selectFrom('paciente')
    .select('id')
    .where('usuario_id', '=', usuarioId)
    .where('id', '=', id)
    .executeTakeFirst();
  return linha !== undefined;
}

const paraTcle = (linha: {
  id: string;
  finalidade: string;
  data: string;
  versao: string;
  criado_em: Date;
}): Tcle => ({
  id: linha.id,
  finalidade: linha.finalidade,
  data: linha.data,
  versao: linha.versao,
  registrado_em: linha.criado_em.toISOString(),
});

export const rotasTcle = new Hono<AmbienteAutenticado>()
  .get('/pacientes/:id/tcle', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const pacienteId = c.req.param('id');
    if (!(await pacienteExiste(trx, usuarioId, pacienteId))) return naoEncontrado(c);
    const linhas = await trx
      .selectFrom('consentimento_tcle')
      .select(COLUNAS_TCLE)
      .where('usuario_id', '=', usuarioId)
      .where('paciente_id', '=', pacienteId)
      .orderBy('data_consentimento', 'desc')
      .orderBy('criado_em', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return c.json<{ items: Tcle[] }>({ items: linhas.map(paraTcle) });
  })
  .post('/pacientes/:id/tcle', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const pacienteId = c.req.param('id');
    if (!(await pacienteExiste(trx, usuarioId, pacienteId))) return naoEncontrado(c);
    const leitura = await lerCorpo(c, esquemaTcleEntrada);
    if (!leitura.ok) return leitura.resposta;
    const linha = await trx
      .insertInto('consentimento_tcle')
      .values({
        usuario_id: usuarioId,
        paciente_id: pacienteId,
        finalidade: leitura.dados.finalidade,
        data_consentimento: leitura.dados.data,
        versao_termo: leitura.dados.versao,
      })
      .returning(COLUNAS_TCLE)
      .executeTakeFirstOrThrow();
    return c.json(paraTcle(linha), 201);
  });
