import {
  PROBLEMA_RASCUNHO_INVALIDO,
  PROBLEMA_VERSAO_RASCUNHO,
  type Rascunho,
  esquemaRascunhoEntrada,
} from '@es/contrato/clinico';
import { decidirGravacao, lerChaveRascunho, lerIfMatch } from '@es/dominio/clinico/rascunho';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// RAS-01, RAS-02, ISO-02: PUT /api/rascunhos/:tipo/:ref e GET /api/rascunhos?tipo=&ref=, rotas
// autenticadas. Adaptado de DraftsController e DraftsService do legado (decisão do usuário em
// 2026-10-26: rotas, ETag e {items} como no legado).
// - Chave (tipo, ref) no formato do legado; para evolucao e anamnese o ref é UUID. Chave ou
//   If-Match em formato inválido: 400 (sem ecoar a chave).
// - Payload objeto JSON até 512 KiB (contrato): acima, 422 validacao.
// - Upsert sem apagar: sem rascunho, cria com If-Match ausente ou "0"; com rascunho, substitui
//   só na versão atual. O resto (e a corrida entre dois pedidos) responde 412
//   PRECONDITION_FAILED. A resposta traz o ETag com a versão.
// - Nada é apagado: não há rota DELETE, e gravar a evolução não mexe no rascunho (decisão do
//   usuário). Sem auditoria (como no legado): o payload é texto clínico e não sai daqui.
// - RLS: B não enxerga a chave de A; para B ela não existe.

const COLUNAS = [
  'tipo',
  'ref',
  'payload',
  'row_version',
  sql<Date>`atualizado_em`.as('atualizado_em'),
] as const;

const paraRascunho = (linha: {
  tipo: string;
  ref: string;
  payload: unknown;
  row_version: number;
  atualizado_em: Date;
}): Rascunho => ({
  tipo: linha.tipo,
  ref: linha.ref,
  payload: linha.payload as Record<string, unknown>,
  row_version: linha.row_version,
  atualizado_em: new Date(linha.atualizado_em).toISOString(),
});

// Valida o filtro da leitura. Só o tipo: confere o formato dele com um ref UUID qualquer.
const filtroValido = (tipo: string | undefined, ref: string | undefined): boolean => {
  if (ref !== undefined) return lerChaveRascunho(tipo ?? 'rascunho', ref) !== null;
  if (tipo !== undefined) return lerChaveRascunho(tipo, crypto.randomUUID()) !== null;
  return true;
};

export const rotasRascunhos = new Hono<AmbienteAutenticado>()
  .get('/rascunhos', ...autenticada, async (c) => {
    const { trx } = c.var;
    const tipo = c.req.query('tipo');
    const ref = c.req.query('ref');
    if (!filtroValido(tipo, ref)) return responderProblema(c, PROBLEMA_RASCUNHO_INVALIDO);
    let consulta = trx.selectFrom('rascunho').select(COLUNAS);
    if (tipo !== undefined) consulta = consulta.where('tipo', '=', tipo);
    if (ref !== undefined) consulta = consulta.where('ref', '=', ref);
    const linhas = await consulta.orderBy('atualizado_em', 'desc').orderBy('id').execute();
    return c.json({ items: linhas.map(paraRascunho) });
  })
  .put('/rascunhos/:tipo/:ref', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const chave = lerChaveRascunho(c.req.param('tipo'), c.req.param('ref'));
    const ifMatch = lerIfMatch(c.req.header('If-Match'));
    if (!chave || ifMatch === 'invalido') return responderProblema(c, PROBLEMA_RASCUNHO_INVALIDO);
    const leitura = await lerCorpo(c, esquemaRascunhoEntrada);
    if (!leitura.ok) return leitura.resposta;
    const payload = JSON.stringify(leitura.dados.payload);

    const atual = await trx
      .selectFrom('rascunho')
      .select(['id', 'row_version'])
      .where('tipo', '=', chave.tipo)
      .where('ref', '=', chave.ref)
      .forUpdate()
      .executeTakeFirst();
    const decisao = decidirGravacao(atual?.row_version ?? null, ifMatch);
    if (decisao === 'conflito') return responderProblema(c, PROBLEMA_VERSAO_RASCUNHO);

    const gravado =
      decisao === 'criar'
        ? await trx
            .insertInto('rascunho')
            .values({ usuario_id: usuarioId, tipo: chave.tipo, ref: chave.ref, payload })
            .onConflict((oc) => oc.columns(['usuario_id', 'tipo', 'ref']).doNothing())
            .returning(COLUNAS)
            .executeTakeFirst()
        : await trx
            .updateTable('rascunho')
            .set({
              payload,
              row_version: sql<number>`row_version + 1`,
              atualizado_em: sql<Date>`now()`,
            })
            .where('id', '=', atual!.id)
            .where('row_version', '=', ifMatch as number)
            .returning(COLUNAS)
            .executeTakeFirst();
    if (!gravado) return responderProblema(c, PROBLEMA_VERSAO_RASCUNHO);
    c.header('ETag', `"${gravado.row_version}"`);
    return c.json(paraRascunho(gravado));
  });
