import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

// T136 / PUSH-07 (ADR-010): a conta da Cloudflare tem 5 Cron Triggers divididos entre 3 apps, e
// este Worker usa um só, a cada 5 minutos; o despachante chama as tarefas.

const raiz = resolve(import.meta.dirname, '../../..');
const config = parse(readFileSync(join(raiz, 'wrangler.jsonc'), 'utf8')) as {
  triggers?: { crons?: unknown };
};

describe('wrangler.jsonc: cron único (PUSH-07)', () => {
  it('tem exatamente um Cron Trigger, */5 * * * *', () => {
    expect(config.triggers?.crons).toEqual(['*/5 * * * *']);
  });
});
