import {
  PROBLEMA_CURSOR_INVALIDO,
  PROBLEMA_PAGINA_INVALIDA,
  TABELAS_EXPORTACAO,
  type TabelaExportacao,
  esquemaConsultaExportacao,
} from '@es/contrato/exportacao';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Trx } from '../db.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { limiteExportacao } from '../middleware/limite-exportacao.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// EXP-03, EXP-04, ISO-02 (D-32): GET /api/exportacao?cursor=&limite=, a exportação completa em
// páginas por tabela. Adaptado de export-full.domain.ts do legado (lista de tabelas e linhas
// inteiras); lá a exportação saía numa resposta só, aqui sai em páginas porque a inteira custa
// cerca de 1 s de CPU contra 10 ms no Free (spike cpu-exportacao).
// - Uma tabela por página, na ordem de TABELAS_EXPORTACAO, e dentro dela pela chave primária
//   (id). Tamanho máximo de página: 25 linhas (T122).
// - O JSON da página é montado no Postgres (json_agg de to_jsonb da linha), mais barato em CPU
//   do que serializar no Worker (T122, medicao-exportacao.md); o Worker só junta o texto.
// - Cursor opaco (PREMISSA de 2026-10-27): base64url de {"t": tabela, "d": última chave servida
//   ou null para o começo da tabela}. Página com mais linhas aponta para a mesma tabela; a que
//   esgota a tabela aponta para o começo da próxima; a última da última tabela traz null.
// - Limite acima do máximo, fora do formato ou parâmetro desconhecido: 400 pagina_invalida;
//   cursor que não decodifica, com tabela fora da lista ou chave fora do tipo da tabela: 400
//   cursor_invalido. Nenhum dos dois audita.
// - Início da exportação (sem cursor) conta no limite de 5 em 60 s (EXP-05, limite-exportacao.ts).
// - Sem credenciais nem sessões (EXP-03): só as tabelas de TABELAS_EXPORTACAO, nenhuma delas de
//   identidade (usuario, credencial_senha, sessao, desafio_2fa, token_email).
// - Servida a última página (proximo_cursor null), audita exportacao.concluida com alvo
//   exportação, sem alvo_id nem conteúdo (EXP-06); cada exportação concluída gera um evento.
// Além do RLS, a consulta filtra por usuario_id; o cursor não leva usuário, então o de outro
// profissional só anda pelo que é do próprio.

// Tabelas com chave bigint (revisões do financeiro); as demais têm chave uuid.
const CHAVE_NUMERICA: ReadonlySet<TabelaExportacao> = new Set([
  'preco_paciente_revisao',
  'preco_sessao_revisao',
  'pagamento_revisao',
]);
const BIGINT = /^[1-9]\d{0,17}$/;

interface Cursor {
  t: TabelaExportacao;
  d: string | null;
}

const esquemaCursor = z.strictObject({
  t: z.enum(TABELAS_EXPORTACAO),
  d: z.string().nullable(),
});

const paraBase64Url = (texto: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(texto)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const codificar = (cursor: Cursor): string => paraBase64Url(JSON.stringify(cursor));

function decodificar(texto: string): Cursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  let conteudo: unknown;
  try {
    const binario = atob(texto.replace(/-/g, '+').replace(/_/g, '/'));
    conteudo = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binario, (ch) => ch.charCodeAt(0))),
    );
  } catch {
    return null;
  }
  const cursor = esquemaCursor.safeParse(conteudo);
  if (!cursor.success) return null;
  const { t, d } = cursor.data;
  if (d !== null && !(CHAVE_NUMERICA.has(t) ? BIGINT.test(d) : idValido(d))) return null;
  return { t, d };
}

interface Lida {
  linhas: string;
  ultimo: string | null;
  tem_mais: boolean;
}

// Lê limite + 1 linhas para saber se a tabela continua; devolve o JSON das `limite` primeiras.
async function lerPagina(
  trx: Trx,
  usuarioId: string,
  { t, d }: Cursor,
  limite: number,
): Promise<Lida> {
  const depois = d === null ? sql`` : sql`and t.id > ${d}`;
  const { rows } = await sql<Lida>`
    select coalesce(json_agg(p.linha order by p.id) filter (where p.n <= ${limite}), '[]')::text
             as linhas,
           max(p.id::text) filter (where p.n = ${limite}) as ultimo,
           count(*) > ${limite} as tem_mais
    from (
      select t.id, to_jsonb(t) as linha, row_number() over (order by t.id) as n
      from ${sql.table(t)} t
      where t.usuario_id = ${usuarioId} ${depois}
      order by t.id
      limit ${limite + 1}
    ) p`.execute(trx);
  return rows[0]!;
}

function proximoCursor(atual: TabelaExportacao, lida: Lida): string | null {
  if (lida.tem_mais) return codificar({ t: atual, d: lida.ultimo });
  const seguinte = TABELAS_EXPORTACAO[TABELAS_EXPORTACAO.indexOf(atual) + 1];
  return seguinte === undefined ? null : codificar({ t: seguinte, d: null });
}

export const rotasExportarTudo = new Hono<AmbienteAutenticado>().get(
  '/exportacao',
  ...autenticada,
  limiteExportacao,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const consulta = esquemaConsultaExportacao.safeParse(c.req.query());
    if (!consulta.success) return responderProblema(c, PROBLEMA_PAGINA_INVALIDA);
    const { limite } = consulta.data;
    const cursor =
      consulta.data.cursor === null
        ? { t: TABELAS_EXPORTACAO[0], d: null }
        : decodificar(consulta.data.cursor);
    if (cursor === null) return responderProblema(c, PROBLEMA_CURSOR_INVALIDO);

    const lida = await lerPagina(trx, usuarioId, cursor, limite);
    const proximo = proximoCursor(cursor.t, lida);
    // EXP-06: a última página conclui a exportação; audita sem conteúdo, na mesma transação.
    if (proximo === null)
      await registrarAuditoria(trx, {
        usuarioId,
        ator: usuarioId,
        acao: 'exportacao.concluida',
        alvoTipo: 'exportacao',
        ip: c.req.header('CF-Connecting-IP') ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
      });
    const corpo = `{"tabela":${JSON.stringify(cursor.t)},"proximo_cursor":${JSON.stringify(
      proximo,
    )},"linhas":${lida.linhas}}`;
    return c.body(corpo, 200, { 'Content-Type': 'application/json' });
  },
);
