import {
  type Perfil,
  PROBLEMA_PERFIL_NAO_ENCONTRADO,
  esquemaPerfilEntrada,
} from '@es/contrato/perfil';
import {
  CAMPOS_PERFIL,
  type DadosPerfil,
  camposAlterados,
  resolverPerfil,
} from '@es/dominio/perfil/perfil';
import { Hono } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';

// PERF-02, PERF-03, PERF-09: GET e PUT /api/perfil, rotas autenticadas (sessão, CSRF na escrita,
// transação do profissional). Adaptado do ProfileService do legado, com uma só especialidade.
// - GET antes do primeiro salvamento responde 404, como no legado. O RLS só mostra a linha do
//   próprio profissional, então o perfil de outro nunca aparece (ISO-02).
// - PUT valida pelo contrato (chave desconhecida = 422, vazio = null), resolve o perfil novo e
//   grava só se algo mudou de fato. A auditoria perfil.editado leva só os nomes dos campos, na
//   mesma transação. Sem mudança, nada é gravado nem auditado.

const consultaPerfil = (trx: Trx, usuarioId: string) =>
  trx
    .selectFrom('perfil')
    .select(['id', ...CAMPOS_PERFIL])
    .where('usuario_id', '=', usuarioId);

function paraResposta(dados: DadosPerfil): Perfil {
  return {
    nome: dados.nome,
    contato: dados.contato,
    endereco: dados.endereco,
    atende_sabado: dados.atende_sabado,
    atende_domingo: dados.atende_domingo,
    especialidade:
      dados.especialidade === null
        ? null
        : {
            tipo: dados.especialidade,
            nome: dados.especialidade_nome,
            conselho: dados.conselho,
            numero_registro: dados.numero_registro,
            regiao: dados.regiao,
          },
  };
}

export const rotasPerfil = new Hono<AmbienteAutenticado>()
  .get('/perfil', ...autenticada, async (c) => {
    const linha = await consultaPerfil(c.var.trx, c.var.usuarioId).executeTakeFirst();
    if (!linha)
      return c.json(PROBLEMA_PERFIL_NAO_ENCONTRADO, 404, {
        'Content-Type': 'application/problem+json',
      });
    return c.json(paraResposta(linha));
  })
  .put('/perfil', ...autenticada, async (c) => {
    const leitura = await lerCorpo(c, esquemaPerfilEntrada);
    if (!leitura.ok) return leitura.resposta;
    const { trx, usuarioId } = c.var;

    const atual = await consultaPerfil(trx, usuarioId).forUpdate().executeTakeFirst();
    const novo = resolverPerfil(atual ?? null, leitura.dados);
    const campos = camposAlterados(atual ?? null, novo);
    if (atual && campos.length === 0) return c.json(paraResposta(atual));

    const { id } = atual
      ? await trx
          .updateTable('perfil')
          .set({
            ...novo,
            row_version: sql<number>`row_version + 1`,
            atualizado_em: sql<Date>`now()`,
          })
          .where('id', '=', atual.id)
          .returning('id')
          .executeTakeFirstOrThrow()
      : await trx
          .insertInto('perfil')
          .values({ ...novo, usuario_id: usuarioId })
          .returning('id')
          .executeTakeFirstOrThrow();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'perfil.editado',
      alvoTipo: 'perfil',
      alvoId: id,
      camposAlterados: campos,
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(paraResposta(novo));
  });
