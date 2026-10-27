import * as Sentry from '@sentry/cloudflare';
import { criarApp } from './app.ts';
import { opcoesSentry } from './sentry.ts';
import { criarAgendado } from './tarefas/despachar.ts';
import { TAREFAS } from './tarefas/registro.ts';

const app = criarApp();

// PUSH-07 (ADR-010): o Cron Trigger único chama o despachante; erro de cada tarefa vai ao Sentry
// com o nome dela.
const agendado = criarAgendado({
  tarefas: TAREFAS,
  capturarErro: (erro, extra) => Sentry.captureException(erro, { tags: extra }),
});

export default Sentry.withSentry((env: Cloudflare.Env) => opcoesSentry(env), {
  fetch: app.fetch,
  scheduled: agendado,
} satisfies ExportedHandler<Cloudflare.Env>);
