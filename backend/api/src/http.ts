import { type CodigoErroIdentidade, type Problema, problema } from '@es/contrato/identidade';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

// Respostas de erro em application/problem+json e leitura do corpo pelo contrato Zod. Erro de
// validação responde 422 `validacao` só com os nomes dos campos, sem ecoar valores.

export function responderProblema(
  c: Context,
  codigo: CodigoErroIdentidade,
  titulo: string,
  extra: Pick<Problema, 'motivo' | 'campos'> = {},
): Response {
  const corpo = problema(codigo, titulo, extra);
  return c.json(corpo, corpo.status as ContentfulStatusCode, {
    'Content-Type': 'application/problem+json',
  });
}

export type Leitura<T> = { ok: true; dados: T } | { ok: false; resposta: Response };

export async function lerCorpo<E extends z.ZodType>(
  c: Context,
  esquema: E,
): Promise<Leitura<z.output<E>>> {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return { ok: false, resposta: responderProblema(c, 'validacao', 'Dados inválidos') };
  }
  const resultado = esquema.safeParse(corpo);
  if (resultado.success) return { ok: true, dados: resultado.data };
  const campos = new Set<string>();
  for (const problemaZod of resultado.error.issues) {
    if (problemaZod.code === 'unrecognized_keys') problemaZod.keys.forEach((k) => campos.add(k));
    else if (problemaZod.path.length > 0) campos.add(String(problemaZod.path[0]));
  }
  return {
    ok: false,
    resposta: responderProblema(c, 'validacao', 'Dados inválidos', { campos: [...campos] }),
  };
}
