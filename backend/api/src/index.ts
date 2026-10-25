import * as Sentry from '@sentry/cloudflare';
import { criarApp } from './app.ts';
import { opcoesSentry } from './sentry.ts';

const app = criarApp();

export default Sentry.withSentry((env: Cloudflare.Env) => opcoesSentry(env), {
  fetch: app.fetch,
} satisfies ExportedHandler<Cloudflare.Env>);
