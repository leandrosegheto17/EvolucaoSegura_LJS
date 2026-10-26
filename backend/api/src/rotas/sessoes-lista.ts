import {
  type PaginaSessoes,
  PROBLEMA_CONSULTA_SESSOES_INVALIDA,
  codificarCursor,
  esquemaListagemSessoes,
} from '@es/contrato/agenda';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { COLUNAS_SESSAO, paraSessao, responderProblemaAgenda } from '../repositorios/sessoes.ts';

// AGE-03: GET /api/sessoes?de&ate&limit&cursor, rota autenticada. Adaptado de
// SessionsController.list e SessionsRepository.list do legado.
// - Sessões cujo início está em [de, ate), de no máximo 62 dias, em qualquer status.
// - Ordem (inicio, id) com cursor keyset: a página seguinte começa depois da última sessão
//   entregue, então inclusão ou mudança antes do cursor não repete nem pula sessão.
// - limit de 1 a 100, padrão 50; proximo_cursor nulo na última página.
// - Parâmetro inválido (intervalo, datas, limit, cursor): 400 consulta_invalida.
// O RLS (e o filtro por usuario_id) só mostra as sessões do próprio profissional (ISO-02).

export const rotasSessoesLista = new Hono<AmbienteAutenticado>().get(
  '/sessoes',
  ...autenticada,
  async (c) => {
    const consulta = esquemaListagemSessoes.safeParse(c.req.query());
    if (!consulta.success) return responderProblemaAgenda(c, PROBLEMA_CONSULTA_SESSOES_INVALIDA);
    const { de, ate, limit, cursor } = consulta.data;

    let selecao = c.var.trx
      .selectFrom('sessao_atendimento')
      .select(COLUNAS_SESSAO)
      // Início com microssegundos, para o cursor (o Date do JS só guarda milissegundos).
      .select(
        sql<string>`to_char(inicio at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          'inicio_cursor',
        ),
      )
      .where('usuario_id', '=', c.var.usuarioId)
      .where('inicio', '>=', new Date(de))
      .where('inicio', '<', new Date(ate));
    if (cursor !== null)
      selecao = selecao.where(
        sql<boolean>`(inicio, id) > (${cursor.inicio}::timestamptz, ${cursor.id}::uuid)`,
      );
    const linhas = await selecao
      .orderBy('inicio')
      .orderBy('id')
      .limit(limit + 1)
      .execute();

    const pagina = linhas.slice(0, limit);
    const ultima = pagina.at(-1);
    return c.json<PaginaSessoes>({
      items: pagina.map(paraSessao),
      proximo_cursor:
        linhas.length > limit && ultima
          ? codificarCursor({ inicio: ultima.inicio_cursor, id: ultima.id })
          : null,
    });
  },
);
