import { z } from 'zod';

// OPS-11: variáveis do Worker. Cada uma está documentada no .env.example (obrigatoriedade,
// formato e se é segredo). As ainda não usadas são opcionais até a etapa que as exige.

const urlPublica = z.string().refine((valor) => {
  if (valor.endsWith('/')) return false;
  const url = URL.parse(valor);
  if (url === null) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
}, 'URL https (http só em localhost), sem barra final');

const base64url = z.string().regex(/^[A-Za-z0-9_-]{32,}$/, 'base64url');

export const esquemaAmbiente = z.object({
  URL_PUBLICA: urlPublica,
  MAIL_FROM: z
    .string()
    .regex(/^([^<>@]+ <)?[^\s<>@]+@evolucaosegura\.com\.br>?$/, 'e-mail de evolucaosegura.com.br')
    .optional(),
  RESEND_API_KEY: z
    .string()
    .regex(/^re_\S+$/, 'começa com re_')
    .optional(),
  // AUTH-03: obrigatória desde a T46 (chave do HMAC do código 2FA).
  HMAC_2FA_SEGREDO: z.string().min(32),
  ASAAS_API_KEY: z.string().min(1).optional(),
  ASAAS_WEBHOOK_TOKEN: z.string().min(32).optional(),
  ASAAS_BASE_URL: z
    .enum(['https://api-sandbox.asaas.com/v3', 'https://api.asaas.com/v3'])
    .optional(),
  VAPID_PUBLIC_KEY: base64url.optional(),
  VAPID_PRIVATE_KEY: base64url.optional(),
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:\S+@\S+|https:\/\/\S+)$/, 'mailto: ou https')
    .optional(),
  SENTRY_DSN: z.url({ protocol: /^https$/ }).optional(),
  SENTRY_RELEASE: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/, 'SHA do commit')
    .optional(),
});

export type Ambiente = z.infer<typeof esquemaAmbiente>;

export class ErroAmbiente extends Error {
  readonly variaveis: string[];
  constructor(variaveis: string[]) {
    super(`Ambiente inválido: ${variaveis.join(', ')}`);
    this.name = 'ErroAmbiente';
    this.variaveis = variaveis;
  }
}

// Falha na partida listando só os NOMES das variáveis com problema, nunca os valores (podem ser segredos).
export function lerAmbiente(env: Record<string, unknown>): Ambiente {
  const resultado = esquemaAmbiente.safeParse(env);
  if (resultado.success) return resultado.data;
  const nomes = new Set(resultado.error.issues.map((problema) => String(problema.path[0])));
  throw new ErroAmbiente([...nomes]);
}
