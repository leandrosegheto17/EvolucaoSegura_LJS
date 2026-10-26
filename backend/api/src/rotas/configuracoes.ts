import {
  CONFIGURACOES_PADRAO,
  type Configuracoes,
  esquemaConfiguracoesEntrada,
} from '@es/contrato/configuracoes';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';

// PERF-08, PERF-09: GET e PUT /api/configuracoes, rotas autenticadas, adaptadas do
// SettingsService do legado. Sem linha gravada, o GET devolve o padrão (privacidade_agenda
// falsa). O PUT grava e audita configuracao.alterada (só nomes de campo, na mesma transação)
// apenas quando o valor muda de fato. O RLS só mostra a linha do próprio profissional (ISO-02).
// Diferença do legado, em favor do PERF-09: o primeiro PUT igual ao padrão não cria a linha nem
// audita (no legado criava e auditava com a lista de campos vazia).

export const rotasConfiguracoes = new Hono<AmbienteAutenticado>()
  .get('/configuracoes', ...autenticada, async (c) => {
    const linha = await c.var.trx
      .selectFrom('configuracao_usuario')
      .select('privacidade_agenda')
      .where('usuario_id', '=', c.var.usuarioId)
      .executeTakeFirst();
    return c.json<Configuracoes>(linha ?? CONFIGURACOES_PADRAO);
  })
  .put('/configuracoes', ...autenticada, async (c) => {
    const leitura = await lerCorpo(c, esquemaConfiguracoesEntrada);
    if (!leitura.ok) return leitura.resposta;
    const { trx, usuarioId } = c.var;
    const novo: Configuracoes = { privacidade_agenda: leitura.dados.privacidade_agenda };

    const atual = await trx
      .selectFrom('configuracao_usuario')
      .select(['id', 'privacidade_agenda'])
      .where('usuario_id', '=', usuarioId)
      .forUpdate()
      .executeTakeFirst();
    const antes = atual ?? CONFIGURACOES_PADRAO;
    if (antes.privacidade_agenda === novo.privacidade_agenda) return c.json(novo);

    const { id } = atual
      ? await trx
          .updateTable('configuracao_usuario')
          .set({
            ...novo,
            row_version: sql<number>`row_version + 1`,
            atualizado_em: sql<Date>`now()`,
          })
          .where('id', '=', atual.id)
          .returning('id')
          .executeTakeFirstOrThrow()
      : await trx
          .insertInto('configuracao_usuario')
          .values({ ...novo, usuario_id: usuarioId })
          .returning('id')
          .executeTakeFirstOrThrow();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'configuracao.alterada',
      alvoTipo: 'configuracao',
      alvoId: id,
      camposAlterados: ['privacidade_agenda'],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(novo);
  });
