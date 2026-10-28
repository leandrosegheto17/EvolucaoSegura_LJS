import {
  JANELA_LIMITE_EXPORTACAO_SEGUNDOS,
  LIMITE_EXPORTACOES,
  PROBLEMA_LIMITE_EXPORTACAO,
} from '@es/contrato/exportacao';
import type { MiddlewareHandler } from 'hono';
import { sql } from 'kysely';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';
import type { AmbienteAutenticado } from './autenticada.ts';

// EXP-05: no máximo 5 exportações completas iniciadas por janela de 60 s, com o contador em
// limite_uso (public.contar_uso, migration 0011; janela fixa a partir do primeiro uso, como o
// export-limits.ts do legado). Roda depois da lista `autenticada`, dentro da transação.
// - Início = pedido sem cursor (EXP-05: a primeira página conta). As páginas seguintes, com
//   cursor, não contam, então uma exportação já iniciada termina mesmo no limite.
// - Só a exportação completa usa este middleware; a rota do prontuário não conta.
// - PREMISSA: o pedido sem cursor conta antes da validação da página; um início com limite
//   inválido conta e responde 400 (ou 429, se já passou do limite).
// - A contagem fica gravada mesmo quando responde 429 (a transação termina com sucesso); a
//   janela recomeça 60 s depois do primeiro início, como no contar_uso.

export const limiteExportacao: MiddlewareHandler<AmbienteAutenticado> = async (c, next) => {
  if (c.req.query('cursor') === undefined) {
    const { rows } = await sql<{ contagem: number }>`
      select public.contar_uso('exportacao', ${JANELA_LIMITE_EXPORTACAO_SEGUNDOS}) as contagem`.execute(
      c.var.trx,
    );
    if (rows[0]!.contagem > LIMITE_EXPORTACOES)
      return responderProblema(c, PROBLEMA_LIMITE_EXPORTACAO);
  }
  await next();
};
