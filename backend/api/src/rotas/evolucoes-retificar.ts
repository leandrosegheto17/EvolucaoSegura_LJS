import {
  PROBLEMA_JANELA_ABERTA,
  PROBLEMA_RETIFICACAO_CONCORRENTE,
  PROBLEMA_SEM_CONTEUDO_NOVO,
} from '@es/contrato/anamnese';
import { PROBLEMA_EVOLUCAO_NAO_ENCONTRADA, esquemaEvolucaoRetificacao } from '@es/contrato/clinico';
import { Hono } from 'hono';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { linhaEvolucao, paraEvolucao } from '../repositorios/evolucoes.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// EVO-05, EVO-06, EVO-07, ISO-02: POST /api/evolucoes/:id/retificacoes, rota autenticada.
// Adaptado de EvolutionService.rectify do legado. Não há rota de exclusão (EVO-07).
// - Evolução inexistente, de outro profissional ou com id malformado: 404.
// - No dia do cadastro (America/Sao_Paulo, relógio do banco): 409 EDIT_WINDOW_OPEN (EVO-06).
// - Texto novo e motivo, até 100.000 cada (contrato). Mesmo texto da versão vigente: 400
//   sem_conteudo_novo (decisão do usuário em 2026-10-26, simetria com o ANA-08).
// - Grava em evolucao_retificacao (só de inclusão) com seq = último + 1; a evolução original não
//   muda e a vigente é a de maior seq (EVO-05). Duas retificações ao mesmo tempo: a que esbarra
//   no seq da outra responde 409 RECTIFICATION_CONFLICT (ON CONFLICT, sem abortar a transação;
//   como na anamnese, sem travar a evolução).
// - Resposta 201 com a evolução e o histórico de versões (decisão do usuário).
// - Audita evolucao.retificada com os nomes dos campos, nunca o texto nem o motivo.

export const rotasEvolucoesRetificar = new Hono<AmbienteAutenticado>().post(
  '/evolucoes/:id/retificacoes',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaEvolucaoRetificacao);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const atual = await linhaEvolucao(trx, id);
    if (!atual) return responderProblema(c, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA);
    if (atual.editavel_hoje) return responderProblema(c, PROBLEMA_JANELA_ABERTA);

    const ultima = await trx
      .selectFrom('evolucao_retificacao')
      .select(['seq', 'texto'])
      .where('evolucao_id', '=', atual.id)
      .orderBy('seq', 'desc')
      .limit(1)
      .executeTakeFirst();
    const textoVigente = ultima?.texto ?? atual.texto;
    if (dados.texto === textoVigente) return responderProblema(c, PROBLEMA_SEM_CONTEUDO_NOVO);

    const gravada = await trx
      .insertInto('evolucao_retificacao')
      .values({
        usuario_id: usuarioId,
        evolucao_id: atual.id,
        seq: (ultima?.seq ?? 0) + 1,
        texto: dados.texto,
        motivo: dados.motivo,
      })
      .onConflict((oc) => oc.columns(['evolucao_id', 'seq']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!gravada) return responderProblema(c, PROBLEMA_RETIFICACAO_CONCORRENTE);
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'evolucao.retificada',
      alvoTipo: 'evolucao',
      alvoId: atual.id,
      camposAlterados: ['texto', 'motivo'],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(await paraEvolucao(trx, atual), 201);
  },
);
