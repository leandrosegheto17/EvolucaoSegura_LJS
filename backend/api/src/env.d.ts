// Bindings e variáveis do Worker (espelham o wrangler.jsonc e o schema de src/ambiente.ts).
declare namespace Cloudflare {
  interface GlobalProps {
    // Padrão documentado pela Cloudflare (`wrangler types`): import() de tipo em arquivo global.
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    mainModule: typeof import('./index.ts');
  }
  interface Env {
    HYPERDRIVE: Hyperdrive;
    // OPS-07 (ADR-006): um namespace do binding ratelimits por grupo de rota.
    LIMITE_ACESSO: RateLimit;
    LIMITE_PUBLICO: RateLimit;
    LIMITE_WEBHOOK: RateLimit;
    // OPS-10: única fonte da URL do app (o deploy passa com --var).
    URL_PUBLICA: string;
    MAIL_FROM?: string;
    RESEND_API_KEY?: string;
    // AUTH-03: chave do HMAC-SHA256 do código 2FA, obrigatória (src/ambiente.ts).
    HMAC_2FA_SEGREDO: string;
    // PLANO-05, PLANO-06: cobrança pelo Asaas (src/ambiente.ts).
    ASAAS_API_KEY?: string;
    ASAAS_WEBHOOK_TOKEN?: string;
    ASAAS_BASE_URL?: string;
    // PUSH-06, PUSH-07 (ADR-011): chaves VAPID; sem elas o push fica desligado.
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    SENTRY_DSN?: string;
    SENTRY_RELEASE?: string;
  }
}
