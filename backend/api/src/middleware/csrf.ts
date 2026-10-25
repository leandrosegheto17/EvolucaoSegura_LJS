import { problema } from '@es/contrato/identidade';
import type { MiddlewareHandler } from 'hono';
import { csrfDaSessao } from '../tokens.ts';
import type { VariaveisSessao } from './sessao.ts';

// AUTH-17: em rota autenticada, todo método que altera dados exige o cabeçalho x-csrf-token com o
// token da sessão (o mesmo devolvido no login, derivado do id do cookie). Ausente ou errado: 403
// csrf_invalido, sem executar. GET, HEAD e OPTIONS passam. Roda depois do middleware de sessão;
// rotas públicas não montam nenhum dos dois.

const LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrf: MiddlewareHandler<{
  Bindings: Cloudflare.Env;
  Variables: VariaveisSessao;
}> = async (c, next) => {
  if (LEITURA.has(c.req.method)) return next();
  const recebido = new TextEncoder().encode(c.req.header('x-csrf-token') ?? '');
  const esperado = new TextEncoder().encode(await csrfDaSessao(c.var.sid));
  // Comparação em tempo constante (o tamanho do token não é segredo).
  const confere =
    recebido.byteLength === esperado.byteLength &&
    crypto.subtle.timingSafeEqual(recebido, esperado);
  if (!confere)
    return c.json(problema('csrf_invalido', 'Token CSRF inválido'), 403, {
      'Content-Type': 'application/problem+json',
    });
  return next();
};
