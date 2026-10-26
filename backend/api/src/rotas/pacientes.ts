import {
  type PaginaPacientes,
  PROBLEMA_CONSULTA_INVALIDA,
  esquemaListagemPacientes,
  esquemaPacienteEntrada,
} from '@es/contrato/pacientes';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { COLUNAS_PACIENTE, paraPaciente } from '../repositorios/pacientes.ts';

// PAC-01, PAC-02, PAC-07: POST e GET /api/pacientes, rotas autenticadas (sessão, CSRF na
// escrita, transação do profissional). Adaptado do PatientsController do legado.
// - POST valida pelo contrato (campo extra = 422, vazio = null) e responde 201 com o paciente.
// - GET filtra por q (parte do nome, ILIKE com os curingas %, _ e \ escapados) e ativo, com
//   limit e offset; parâmetro inválido = 400. Ordem por nome sem diferença de maiúsculas, depois
//   id (como no legado). O RLS só mostra os pacientes do próprio profissional (ISO-02).
// Não existe rota de exclusão (PAC-07): DELETE cai no 404 de rota inexistente.

// Escapa os curingas do LIKE para a busca por nome ser literal (escapeLike do legado).
const escaparLike = (texto: string): string => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export const rotasPacientes = new Hono<AmbienteAutenticado>()
  .post('/pacientes', ...autenticada, async (c) => {
    const leitura = await lerCorpo(c, esquemaPacienteEntrada);
    if (!leitura.ok) return leitura.resposta;
    const linha = await c.var.trx
      .insertInto('paciente')
      .values({ ...leitura.dados, usuario_id: c.var.usuarioId })
      .returning(COLUNAS_PACIENTE)
      .executeTakeFirstOrThrow();
    return c.json(paraPaciente(linha), 201);
  })
  .get('/pacientes', ...autenticada, async (c) => {
    const consulta = esquemaListagemPacientes.safeParse(c.req.query());
    if (!consulta.success)
      return c.json(PROBLEMA_CONSULTA_INVALIDA, 400, {
        'Content-Type': 'application/problem+json',
      });
    const { q, ativo, limit, offset } = consulta.data;

    let selecao = c.var.trx
      .selectFrom('paciente')
      .select(COLUNAS_PACIENTE)
      .where('usuario_id', '=', c.var.usuarioId);
    if (q !== null)
      selecao = selecao.where(sql<boolean>`nome ilike ${`%${escaparLike(q)}%`} escape '\\'`);
    if (ativo !== null) selecao = selecao.where('ativo', '=', ativo);
    const linhas = await selecao
      .orderBy(sql`lower(nome)`)
      .orderBy('id')
      .limit(limit)
      .offset(offset)
      .execute();

    return c.json<PaginaPacientes>({ items: linhas.map(paraPaciente), limit, offset });
  });
