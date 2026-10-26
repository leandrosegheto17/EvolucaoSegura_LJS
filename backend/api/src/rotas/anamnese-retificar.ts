import {
  PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
  PROBLEMA_JANELA_ABERTA,
  PROBLEMA_RETIFICACAO_CONCORRENTE,
  PROBLEMA_SEM_CONTEUDO_NOVO,
  PROBLEMA_VALOR_INVALIDO,
  esquemaRetificacaoEntrada,
} from '@es/contrato/anamnese';
import { itensAlterados, lerValores, versaoVigente } from '@es/dominio/anamnese/valores';
import { Hono } from 'hono';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import {
  itensDoModelo,
  linhaAnamnese,
  modeloDosValores,
  paraAnamnese,
} from '../repositorios/anamnese.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// ANA-06, ANA-07, ANA-08, ISO-02: POST /api/anamneses/:id/retificacoes, rota autenticada.
// Adaptado de rectify-anamnesis.ts do legado.
// - Anamnese inexistente, de outro profissional ou com id malformado: 404.
// - No dia do cadastro (America/Sao_Paulo, relógio do banco): 409 EDIT_WINDOW_OPEN (ANA-07).
// - Nova versão completa (revisão e valores) com motivo de 1 a 5.000 (contrato). A revisão não
//   volta atrás da vigente nem passa da atual do modelo, e os valores passam pelo domínio:
//   inválido = 422 ANAMNESIS_VALUE_INVALID. Pode preencher item incluído depois do cadastro.
// - Sem nenhum valor diferente da versão vigente: 400 (ANA-08).
// - Grava em anamnese_retificacao (só de inclusão) com seq = último + 1; a anamnese original
//   não muda (ANA-06). Duas retificações ao mesmo tempo: a que esbarra no seq da outra
//   responde 409 RECTIFICATION_CONFLICT (ON CONFLICT, sem abortar a transação; decisão do
//   usuário em 2026-10-26, como no legado).
// - Audita anamnese.retificada só com contagens (itens_alterados_N, revisao_N), nunca o motivo
//   nem os valores.

export const rotasAnamneseRetificar = new Hono<AmbienteAutenticado>().post(
  '/anamneses/:id/retificacoes',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaRetificacaoEntrada);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const atual = await linhaAnamnese(trx, { id });
    if (!atual) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    if (atual.editavel_hoje) return responderProblema(c, PROBLEMA_JANELA_ABERTA);

    const retificacoes = await trx
      .selectFrom('anamnese_retificacao')
      .select(['seq', 'modelo_revisao', 'valores'])
      .where('anamnese_id', '=', atual.id)
      .execute();
    const vigente = versaoVigente(
      { modelo_revisao: atual.modelo_revisao, valores: atual.valores },
      retificacoes,
    );
    const modelo = await trx
      .selectFrom('modelo_anamnese')
      .select('revisao')
      .where('id', '=', atual.modelo_id)
      .executeTakeFirstOrThrow();
    if (dados.modelo_revisao < vigente.modelo_revisao || dados.modelo_revisao > modelo.revisao)
      return responderProblema(c, PROBLEMA_VALOR_INVALIDO);
    const valores = lerValores(
      modeloDosValores(await itensDoModelo(trx, atual.modelo_id)),
      dados.valores,
      dados.modelo_revisao,
    );
    if (!valores.ok) return responderProblema(c, PROBLEMA_VALOR_INVALIDO);
    const alterados = itensAlterados(vigente.valores, valores.valores);
    if (alterados.length === 0) return responderProblema(c, PROBLEMA_SEM_CONTEUDO_NOVO);

    const seq = retificacoes.reduce((maior, r) => Math.max(maior, r.seq), 0) + 1;
    const gravada = await trx
      .insertInto('anamnese_retificacao')
      .values({
        usuario_id: usuarioId,
        anamnese_id: atual.id,
        seq,
        motivo: dados.motivo,
        modelo_revisao: dados.modelo_revisao,
        valores: JSON.stringify(valores.valores),
      })
      .onConflict((oc) => oc.columns(['anamnese_id', 'seq']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!gravada) return responderProblema(c, PROBLEMA_RETIFICACAO_CONCORRENTE);
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'anamnese.retificada',
      alvoTipo: 'anamnese',
      alvoId: atual.id,
      camposAlterados: [`itens_alterados_${alterados.length}`, `revisao_${dados.modelo_revisao}`],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(await paraAnamnese(trx, atual), 201);
  },
);
