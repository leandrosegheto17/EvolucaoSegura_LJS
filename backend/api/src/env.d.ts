// Bindings e variáveis do Worker (espelham o wrangler.jsonc e o schema de src/ambiente.ts).
declare namespace Cloudflare {
  interface GlobalProps {
    // Padrão documentado pela Cloudflare (`wrangler types`): import() de tipo em arquivo global.
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    mainModule: typeof import('./index.ts');
  }
  interface Env {
    HYPERDRIVE: Hyperdrive;
    SENTRY_DSN?: string;
    SENTRY_RELEASE?: string;
  }
}
