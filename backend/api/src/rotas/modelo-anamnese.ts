import { PROBLEMA_VERSAO_DIVERGENTE } from '@es/contrato/agenda';
import {
  PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
  PROBLEMA_MODELO_BLOQUEADO,
  PROBLEMA_ROTULO_INVALIDO,
  esquemaModeloGravacao,
} from '@es/contrato/anamnese';
import { type ItemProposto, validarModelo } from '@es/dominio/anamnese/modelo';
import { Hono } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import {
  type ItemDoBanco,
  type ModeloDoBanco,
  existeAnamnese,
  modeloDoPerfil,
  paraModelo,
} from '../repositorios/anamnese.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// ANA-01, ANA-02, ANA-03, PERF-04: GET e PUT /api/modelo-anamnese, rotas autenticadas.
// Adaptado do ModelService do legado, com uma só especialidade (a do perfil).
// - GET: o modelo da especialidade do perfil (criado com o padrão se ainda não existe), com os
//   itens vigentes em ordem e `bloqueado` (existe anamnese). Sem especialidade: 404.
// - PUT: listas completas. O modelo é travado FOR UPDATE (serializa com o registro da anamnese).
//   row_version diferente = 409 versao_divergente. Com anamnese, mexer em item existente = 409
//   MODEL_LOCKED (vem antes do 422); limites, rótulos e "Frequência" = 422 MODEL_LABEL_INVALID,
//   sem ecoar o texto. Decisões do usuário em 2026-10-26.
// - Gravação: "remover" marca removido; item novo entra com revisao_inclusao = revisão nova;
//   rótulos trocados passam por um nome provisório (~id) para não esbarrar no índice único.
// - Sem mudança de fato: 200 sem subir a revisão nem auditar. Com mudança, audita
//   modelo_anamnese.editado só com contagens (nunca rótulos, que são conteúdo clínico).

type TipoItem = 'campo' | 'alerta';

const proposto = (item: {
  id?: string | undefined;
  rotulo: string;
  especial?: 'frequencia' | undefined;
}): ItemProposto => ({
  ...(item.id === undefined ? {} : { id: item.id }),
  rotulo: item.rotulo,
  ...(item.especial === undefined ? {} : { especial: item.especial }),
});

function houveMudanca(atuais: ItemDoBanco[], listas: Record<TipoItem, ItemProposto[]>): boolean {
  return (['campo', 'alerta'] as const).some((tipo) => {
    const daqui = atuais.filter((i) => i.tipo === tipo);
    const lista = listas[tipo];
    return (
      lista.length !== daqui.length ||
      lista.some(
        (p, indice) =>
          p.id !== daqui[indice]!.id ||
          p.rotulo.trim() !== daqui[indice]!.rotulo ||
          (p.especial === 'frequencia') !== daqui[indice]!.especial,
      )
    );
  });
}

async function aplicar(
  trx: Trx,
  usuarioId: string,
  modelo: ModeloDoBanco,
  listas: Record<TipoItem, ItemProposto[]>,
  revisao: number,
): Promise<void> {
  const porId = new Map(modelo.itens.map((i) => [i.id, i]));
  const mantidos = new Set(
    [...listas.campo, ...listas.alerta].map((p) => p.id).filter((id): id is string => !!id),
  );
  const atualizar = (id: string, valores: Record<string, unknown>) =>
    trx
      .updateTable('modelo_anamnese_item')
      .set({
        ...valores,
        row_version: sql<number>`row_version + 1`,
        atualizado_em: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .execute();

  // 1. Remove os que saíram e tira rótulo e especial dos que mudam (libera os índices únicos).
  for (const item of modelo.itens) {
    if (!mantidos.has(item.id)) await atualizar(item.id, { removido: true });
  }
  const mudados = new Set<string>();
  for (const p of [...listas.campo, ...listas.alerta]) {
    const item = p.id === undefined ? undefined : porId.get(p.id);
    if (
      item &&
      (item.rotulo !== p.rotulo.trim() || item.especial !== (p.especial === 'frequencia'))
    ) {
      mudados.add(item.id);
      await atualizar(item.id, { rotulo: `~${item.id}`, especial: false });
    }
  }
  // 2. Grava cada lista na ordem pedida.
  for (const tipo of ['campo', 'alerta'] as const) {
    for (const [ordem, p] of listas[tipo].entries()) {
      const rotulo = p.rotulo.trim();
      const especial = p.especial === 'frequencia';
      const item = p.id === undefined ? undefined : porId.get(p.id);
      if (!item) {
        await trx
          .insertInto('modelo_anamnese_item')
          .values({
            usuario_id: usuarioId,
            modelo_id: modelo.id,
            tipo,
            especial,
            rotulo,
            ordem,
            revisao_inclusao: revisao,
          })
          .execute();
      } else if (mudados.has(item.id) || item.ordem !== ordem) {
        await atualizar(item.id, { rotulo, especial, ordem });
      }
    }
  }
  await trx
    .updateTable('modelo_anamnese')
    .set({ revisao, row_version: sql<number>`row_version + 1`, atualizado_em: sql<Date>`now()` })
    .where('id', '=', modelo.id)
    .execute();
}

export const rotasModeloAnamnese = new Hono<AmbienteAutenticado>()
  .get('/modelo-anamnese', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const modelo = await modeloDoPerfil(trx, usuarioId, false);
    if (!modelo) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    return c.json(paraModelo(modelo, await existeAnamnese(trx)));
  })
  .put('/modelo-anamnese', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const leitura = await lerCorpo(c, esquemaModeloGravacao);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;

    const modelo = await modeloDoPerfil(trx, usuarioId, true);
    if (!modelo) return responderProblema(c, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    if (modelo.row_version !== dados.row_version)
      return responderProblema(c, PROBLEMA_VERSAO_DIVERGENTE);

    const bloqueado = await existeAnamnese(trx);
    const listas = { campo: dados.campos.map(proposto), alerta: dados.alertas.map(proposto) };
    const daLista = (tipo: TipoItem) =>
      modelo.itens
        .filter((i) => i.tipo === tipo)
        .map((i) => ({
          id: i.id,
          rotulo: i.rotulo,
          ...(i.especial ? { especial: 'frequencia' as const } : {}),
        }));
    const validacao = validarModelo(
      { bloqueado, campos: daLista('campo'), alertas: daLista('alerta') },
      { campos: listas.campo, alertas: listas.alerta },
    );
    if (!validacao.ok)
      return responderProblema(
        c,
        validacao.violacoes.some((v) => v.categoria === 'bloqueado')
          ? PROBLEMA_MODELO_BLOQUEADO
          : PROBLEMA_ROTULO_INVALIDO,
      );
    if (!houveMudanca(modelo.itens, listas)) return c.json(paraModelo(modelo, bloqueado));

    const revisao = modelo.revisao + 1;
    await aplicar(trx, usuarioId, modelo, listas, revisao);
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'modelo_anamnese.editado',
      alvoTipo: 'modelo_anamnese',
      alvoId: modelo.id,
      camposAlterados: [
        `campos_${listas.campo.length}`,
        `alertas_${listas.alerta.length}`,
        `revisao_${revisao}`,
      ],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    const novo = await modeloDoPerfil(trx, usuarioId, false);
    return c.json(paraModelo(novo!, bloqueado));
  });
