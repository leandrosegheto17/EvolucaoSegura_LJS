import {
  type ModeloTexto,
  PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
  PROBLEMA_NOME_MODELO_EXISTENTE,
  esquemaListagemModelosTexto,
  esquemaModeloTextoEdicao,
  esquemaModeloTextoEntrada,
} from '@es/contrato/clinico';
import { PROBLEMA_CONSULTA_INVALIDA } from '@es/contrato/pacientes';
import { nomeEmUso } from '@es/dominio/clinico/modelo-texto';
import { Hono } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// RAS-03, ISO-02: GET, POST e PUT /api/modelos-texto, rotas autenticadas. Adaptado de
// TemplatesController e TemplatesService do legado, só com o tipo evolucao.
// Decisões do usuário (2026-10-26): tipo obrigatório e só evolucao (contrato, 422); PUT {nome,
// corpo, arquivado} edita e arquiva ou desarquiva (arquivado ausente = desarquiva), como no
// legado; nome duplicado = 409 TEMPLATE_NAME_EXISTS.
// - Nome único (aparado, sem diferenciar maiúsculas) entre os não arquivados do profissional,
//   pelo domínio, com os modelos dele travados FOR UPDATE; o índice único do banco e o ON
//   CONFLICT da criação cobrem a corrida.
// - Arquivar em vez de apagar: não há rota DELETE; arquivado sai da lista padrão e aparece com
//   ?arquivados=true.
// - Modelo de outro profissional, inexistente ou id malformado: 404.
// - Sem auditoria (como no legado): é texto do próprio profissional, sem dado de paciente.

const COLUNAS = [
  'id',
  'tipo',
  'nome',
  'corpo',
  sql<boolean>`arquivado_em is not null`.as('arquivado'),
  'row_version',
] as const;

// Modelos do profissional (o RLS só mostra os dele), travados para checar o nome.
const modelosTravados = (trx: Trx) =>
  trx
    .selectFrom('modelo_texto')
    .select(['id', 'nome', sql<boolean>`arquivado_em is not null`.as('arquivado')])
    .forUpdate()
    .execute();

export const rotasModelosTexto = new Hono<AmbienteAutenticado>()
  .get('/modelos-texto', ...autenticada, async (c) => {
    const { trx } = c.var;
    const consulta = esquemaListagemModelosTexto.safeParse(c.req.query());
    if (!consulta.success) return responderProblema(c, PROBLEMA_CONSULTA_INVALIDA);
    let selecao = trx.selectFrom('modelo_texto').select(COLUNAS);
    if (!consulta.data.arquivados) selecao = selecao.where('arquivado_em', 'is', null);
    const items: ModeloTexto[] = await selecao
      .orderBy(sql`lower(nome)`)
      .orderBy('id')
      .execute();
    return c.json({ items });
  })
  .post('/modelos-texto', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const leitura = await lerCorpo(c, esquemaModeloTextoEntrada);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;
    if (nomeEmUso(dados.nome, await modelosTravados(trx)))
      return responderProblema(c, PROBLEMA_NOME_MODELO_EXISTENTE);
    const criado = await trx
      .insertInto('modelo_texto')
      .values({ usuario_id: usuarioId, tipo: dados.tipo, nome: dados.nome, corpo: dados.corpo })
      .onConflict((oc) =>
        oc
          .expression(sql`usuario_id, tipo, lower(nome)`)
          .where('arquivado_em', 'is', null)
          .doNothing(),
      )
      .returning(COLUNAS)
      .executeTakeFirst();
    if (!criado) return responderProblema(c, PROBLEMA_NOME_MODELO_EXISTENTE);
    return c.json(criado satisfies ModeloTexto, 201);
  })
  .put('/modelos-texto/:id', ...autenticada, async (c) => {
    const { trx } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaModeloTextoEdicao);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const existentes = await modelosTravados(trx);
    if (!existentes.some((m) => m.id === id))
      return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    if (!dados.arquivado && nomeEmUso(dados.nome, existentes, id))
      return responderProblema(c, PROBLEMA_NOME_MODELO_EXISTENTE);
    const alterado = await trx
      .updateTable('modelo_texto')
      .set({
        nome: dados.nome,
        corpo: dados.corpo,
        arquivado_em: dados.arquivado ? sql<Date>`coalesce(arquivado_em, now())` : null,
        row_version: sql<number>`row_version + 1`,
        atualizado_em: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .returning(COLUNAS)
      .executeTakeFirstOrThrow();
    return c.json(alterado satisfies ModeloTexto);
  });
