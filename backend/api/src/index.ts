import { criarApp } from './app.ts';

const app = criarApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Cloudflare.Env>;
