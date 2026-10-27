import { csrf } from './csrf.ts';
import { sessao } from './sessao.ts';
import { type VariaveisTransacao, transacao } from './transacao.ts';

// Pipeline de rota autenticada, na ordem do design: sessão (cookie, 401), CSRF em escrita (403)
// e transação com o usuário. O exigePlano e o limite de pacientes do Free (middleware/plano.ts)
// entram depois desta lista, dentro da transação, nas rotas que pedirem. As rotas públicas não
// usam esta lista. Os cabeçalhos e o rate limit
// ficam no app inteiro (app.ts), antes de tudo.

export const autenticada = [sessao, csrf, transacao] as const;

export type AmbienteAutenticado = { Bindings: Cloudflare.Env; Variables: VariaveisTransacao };
