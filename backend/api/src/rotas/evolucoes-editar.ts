import { PROBLEMA_VERSAO_DIVERGENTE } from '@es/contrato/agenda';
import { PROBLEMA_JANELA_FECHADA } from '@es/contrato/anamnese';
import { PROBLEMA_EVOLUCAO_NAO_ENCONTRADA, esquemaEvolucaoGravacao } from '@es/contrato/clinico';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { linhaEvolucao, paraEvolucao } from '../repositorios/evolucoes.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// EVO-04, ISO-02: PUT /api/evolucoes/:id, rota autenticada. Adaptado de EvolutionService.update
// do legado.
// - Evolução inexistente, de outro profissional ou com id malformado: 404.
// - Só no dia do cadastro em America/Sao_Paulo pelo relógio do banco; depois, 409
//   EDIT_WINDOW_CLOSED e auditoria evolucao.edicao_recusada (a resposta de erro não desfaz a
//   transação). O trigger do banco (ES002) é a última barreira na virada do dia.
// - row_version obrigatório (contrato); divergente = 409 versao_divergente (decisão do usuário no
//   lote 11; o legado dava 412). A janela fechada vem antes do row_version, como na anamnese.
// - Sem mudança de texto: 200 sem gravar nem auditar (PREMISSA do lote 11).
// - Auditoria evolucao.editada_no_dia só com o nome do campo, nunca o texto.

export const rotasEvolucoesEditar = new Hono<AmbienteAutenticado>().put(
  '/evolucoes/:id',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaEvolucaoGravacao);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const atual = await linhaEvolucao(trx, id, true);
    if (!atual) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    const origem = {
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    };
    if (!atual.editavel_hoje) {
      await registrarAuditoria(trx, {
        usuarioId,
        ator: usuarioId,
        acao: 'evolucao.edicao_recusada',
        alvoTipo: 'evolucao',
        alvoId: atual.id,
        ...origem,
      });
      return responderProblema(c, PROBLEMA_JANELA_FECHADA);
    }
    if (atual.row_version !== dados.row_version)
      return responderProblema(c, PROBLEMA_VERSAO_DIVERGENTE);
    if (dados.texto === atual.texto) return c.json(await paraEvolucao(trx, atual));

    await trx
      .updateTable('evolucao')
      .set({
        texto: dados.texto,
        row_version: sql<number>`row_version + 1`,
        atualizado_em: sql<Date>`now()`,
      })
      .where('id', '=', atual.id)
      .execute();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'evolucao.editada_no_dia',
      alvoTipo: 'evolucao',
      alvoId: atual.id,
      camposAlterados: ['texto'],
      ...origem,
    });
    const linha = await linhaEvolucao(trx, atual.id);
    return c.json(await paraEvolucao(trx, linha!));
  },
);
