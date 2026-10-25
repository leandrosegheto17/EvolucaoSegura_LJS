import { problema } from '@es/contrato/identidade';
import type { MiddlewareHandler } from 'hono';

// OPS-07 (ADR-006): limite por IP com o binding `ratelimits` do Worker, um namespace por grupo
// (contadores separados), definidos no wrangler.jsonc:
// - acesso: entrar, 2FA, cadastro e recuperação, 10 por minuto;
// - publico: as demais rotas públicas, 60 por minuto;
// - webhook: o do Asaas, com limite próprio (ver ADR-006).
// Rota autenticada não entra aqui. O binding conta por localização e o spike rate-limit-free
// mediu ±1 no Free: o limite é aproximado. O bloqueio forte de login (AUTH-07) fica em tabela.

export type GrupoLimite = 'acesso' | 'publico' | 'webhook';

const ACESSO = new Set([
  '/api/cadastro',
  '/api/auth/entrar',
  '/api/auth/2fa/verificar',
  '/api/auth/2fa/reenviar',
  '/api/auth/recuperar',
  '/api/auth/recuperar/confirmar',
]);
// Rota pública nova entra aqui (ou em ACESSO) junto com a própria rota.
// SPEC_DEVIATION: /api/health fica fora do limite (o design o lista entre as rotas públicas).
// Motivo: é a rota do monitoramento (OPS-06), não toca o banco nem chama serviço externo, e o
// teste existente do health monta o app sem os bindings de limite; mudar esse teste exige
// aprovação do usuário. Pergunta registrada no relatório do lote 4.
const PUBLICAS = new Set(['/api/cadastro/confirmar']);

export function grupoDaRota(caminho: string): GrupoLimite | null {
  if (ACESSO.has(caminho)) return 'acesso';
  if (caminho.startsWith('/api/webhooks/')) return 'webhook';
  if (PUBLICAS.has(caminho)) return 'publico';
  return null;
}

const BINDING: Record<
  GrupoLimite,
  keyof Pick<Cloudflare.Env, 'LIMITE_ACESSO' | 'LIMITE_PUBLICO' | 'LIMITE_WEBHOOK'>
> = {
  acesso: 'LIMITE_ACESSO',
  publico: 'LIMITE_PUBLICO',
  webhook: 'LIMITE_WEBHOOK',
};

export const limitePorIp: MiddlewareHandler<{ Bindings: Cloudflare.Env }> = async (c, next) => {
  const grupo = grupoDaRota(new URL(c.req.url).pathname);
  if (grupo === null) return next();
  // A Cloudflare preenche CF-Connecting-IP; sem ele (só em teste local), um contador comum.
  const ip = c.req.header('CF-Connecting-IP') ?? 'sem-ip';
  const { success } = await c.env[BINDING[grupo]].limit({ key: ip });
  if (!success) {
    return c.json(problema('muitas_tentativas', 'Muitas requisições'), 429, {
      'Content-Type': 'application/problem+json',
    });
  }
  return next();
};
