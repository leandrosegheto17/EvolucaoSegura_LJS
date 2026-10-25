import { csrf } from './csrf.ts';
import { sessao } from './sessao.ts';
import { type VariaveisTransacao, transacao } from './transacao.ts';

// Pipeline de rota autenticada, na ordem do design: sessão (cookie, 401), CSRF em escrita (403)
// e transação com o usuário. O exigePlano entra entre o CSRF e a transação, nas rotas que pedirem
// plano (etapa de cobrança). As rotas públicas não usam esta lista. Os cabeçalhos e o rate limit
// ficam no app inteiro (app.ts), antes de tudo.

export const autenticada = [sessao, csrf, transacao] as const;

export type AmbienteAutenticado = { Bindings: Cloudflare.Env; Variables: VariaveisTransacao };
