import { PROBLEMA_VERSAO_DIVERGENTE } from '@es/contrato/agenda';
import {
  PROBLEMA_ANAMNESE_EXISTENTE,
  PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
  PROBLEMA_JANELA_FECHADA,
  PROBLEMA_VALOR_INVALIDO,
  esquemaAnamneseEntrada,
  esquemaAnamneseGravacao,
} from '@es/contrato/anamnese';
import { itensAlterados, lerValores } from '@es/dominio/anamnese/valores';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import {
  itensDoModelo,
  linhaAnamnese,
  modeloDoPerfil,
  modeloDosValores,
  paraAnamnese,
} from '../repositorios/anamnese.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// ANA-04, ANA-05, ANA-09, ISO-02: GET e POST /api/pacientes/:id/anamnese e PUT
// /api/anamneses/:id, rotas autenticadas. Adaptado de create-anamnesis.ts e
// update-anamnesis.ts do legado, com uma só especialidade.
// - Paciente ou anamnese inexistente, de outro profissional ou com id malformado: 404.
// - GET: 200 {anamnese} ou {anamnese: null} (decisão do usuário em 2026-10-26).
// - POST: uma por paciente (409 ANAMNESIS_EXISTS, também na corrida, pelo ON CONFLICT); a
//   linha do perfil é travada FOR SHARE (a troca de especialidade espera, PERF-05) e o modelo
//   FOR UPDATE (a edição do modelo espera, ANA-03). Valores pelo domínio: inválido = 422
//   ANAMNESIS_VALUE_INVALID, sem conteúdo. Paciente inativo pode ter anamnese.
// - PUT: só no dia do cadastro em America/Sao_Paulo pelo relógio do banco; depois, 409
//   EDIT_WINDOW_CLOSED e auditoria anamnese.edicao_recusada (a resposta de erro não desfaz a
//   transação). row_version obrigatório (divergente = 409 versao_divergente). A revisão do
//   modelo não volta atrás nem passa da atual. Sem mudança de fato: 200 sem gravar nem auditar.
// - Auditoria só com contagens, nunca conteúdo: anamnese.criada e anamnese.editada_no_dia
//   (campos_N = itens alterados).

const origem = (c: { req: { header: (nome: string) => string | undefined } }) => ({
  ip: c.req.header('CF-Connecting-IP') ?? null,
  userAgent: c.req.header('User-Agent') ?? null,
});

export const rotasAnamnese = new Hono<AmbienteAutenticado>()
  .get('/pacientes/:id/anamnese', ...autenticada, async (c) => {
    const { trx } = c.var;
    const pacienteId = c.req.param('id');
    if (!idValido(pacienteId)) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    const paciente = await trx
      .selectFrom('paciente')
      .select('id')
      .where('id', '=', pacienteId)
      .executeTakeFirst();
    if (!paciente) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    const linha = await linhaAnamnese(trx, { pacienteId });
    return c.json({ anamnese: linha ? await paraAnamnese(trx, linha) : null });
  })
  .post('/pacientes/:id/anamnese', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const pacienteId = c.req.param('id');
    if (!idValido(pacienteId)) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaAnamneseEntrada);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const paciente = await trx
      .selectFrom('paciente')
      .select('id')
      .where('id', '=', pacienteId)
      .executeTakeFirst();
    if (!paciente) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    await trx
      .selectFrom('perfil')
      .select('id')
      .where('usuario_id', '=', usuarioId)
      .forShare()
      .execute();
    const modelo = await modeloDoPerfil(trx, usuarioId, true);
    if (!modelo) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    if (await linhaAnamnese(trx, { pacienteId }))
      return responderProblema(c, PROBLEMA_ANAMNESE_EXISTENTE);
    if (dados.modelo_revisao > modelo.revisao) return responderProblema(c, PROBLEMA_VALOR_INVALIDO);
    const valores = lerValores(modeloDosValores(modelo.itens), dados.valores, dados.modelo_revisao);
    if (!valores.ok) return responderProblema(c, PROBLEMA_VALOR_INVALIDO);

    const criada = await trx
      .insertInto('anamnese')
      .values({
        usuario_id: usuarioId,
        paciente_id: pacienteId,
        modelo_id: modelo.id,
        data_sessao: dados.data_sessao,
        modelo_revisao: dados.modelo_revisao,
        valores: JSON.stringify(valores.valores),
      })
      .onConflict((oc) => oc.column('paciente_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!criada) return responderProblema(c, PROBLEMA_ANAMNESE_EXISTENTE);
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'anamnese.criada',
      alvoTipo: 'anamnese',
      alvoId: criada.id,
      ...origem(c),
    });
    const linha = await linhaAnamnese(trx, { id: criada.id });
    return c.json(await paraAnamnese(trx, linha!), 201);
  })
  .put('/anamneses/:id', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const id = c.req.param('id');
    if (!idValido(id)) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    const leitura = await lerCorpo(c, esquemaAnamneseGravacao);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const atual = await linhaAnamnese(trx, { id }, true);
    if (!atual) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    if (!atual.editavel_hoje) {
      await registrarAuditoria(trx, {
        usuarioId,
        ator: usuarioId,
        acao: 'anamnese.edicao_recusada',
        alvoTipo: 'anamnese',
        alvoId: atual.id,
        ...origem(c),
      });
      return responderProblema(c, PROBLEMA_JANELA_FECHADA);
    }
    if (atual.row_version !== dados.row_version)
      return responderProblema(c, PROBLEMA_VERSAO_DIVERGENTE);
    const modelo = await trx
      .selectFrom('modelo_anamnese')
      .select('revisao')
      .where('id', '=', atual.modelo_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (dados.modelo_revisao < atual.modelo_revisao || dados.modelo_revisao > modelo.revisao)
      return responderProblema(c, PROBLEMA_VALOR_INVALIDO);
    const valores = lerValores(
      modeloDosValores(await itensDoModelo(trx, atual.modelo_id)),
      dados.valores,
      dados.modelo_revisao,
    );
    if (!valores.ok) return responderProblema(c, PROBLEMA_VALOR_INVALIDO);

    const alterados = itensAlterados(atual.valores, valores.valores);
    if (alterados.length === 0 && dados.modelo_revisao === atual.modelo_revisao)
      return c.json(await paraAnamnese(trx, atual));
    await trx
      .updateTable('anamnese')
      .set({
        modelo_revisao: dados.modelo_revisao,
        valores: JSON.stringify(valores.valores),
        row_version: sql<number>`row_version + 1`,
        atualizado_em: sql<Date>`now()`,
      })
      .where('id', '=', atual.id)
      .execute();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'anamnese.editada_no_dia',
      alvoTipo: 'anamnese',
      alvoId: atual.id,
      camposAlterados: [`campos_${alterados.length}`],
      ...origem(c),
    });
    const linha = await linhaAnamnese(trx, { id: atual.id });
    return c.json(await paraAnamnese(trx, linha!));
  });
