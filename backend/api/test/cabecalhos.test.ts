import { describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.ts';

// OPS-09 (cabeçalhos de segurança) e PUB-05 (no-store em /api/*).

const env = {} as Cloudflare.Env;

function appComRotaQueFalha() {
  const app = criarApp();
  app.get('/api/falha', () => {
    throw new Error('erro não previsto');
  });
  return app;
}

describe('cabeçalhos de segurança (OPS-09)', () => {
  it('traz HSTS, nosniff e Referrer-Policy no-referrer', async () => {
    const { headers } = await criarApp().request('/api/health', {}, env);

    expect(headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it("traz CSP com frame-ancestors 'none' e default-src 'self'", async () => {
    const csp = (await criarApp().request('/api/health', {}, env)).headers.get(
      'Content-Security-Policy',
    );

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it('não permite origem externa na CSP além do Sentry', async () => {
    const csp = (await criarApp().request('/api/health', {}, env)).headers.get(
      'Content-Security-Policy',
    );
    const fontes = (csp ?? '')
      .split(';')
      .flatMap((diretiva) => diretiva.trim().split(/\s+/).slice(1))
      .filter((fonte) => /^(https?:|\*|wss?:)/.test(fonte));

    expect(fontes.length).toBeGreaterThan(0);
    for (const fonte of fontes) expect(fonte).toMatch(/^https:\/\/\*\.ingest(\.us)?\.sentry\.io$/);
  });

  it('aplica os cabeçalhos também fora de /api, sem no-store', async () => {
    const { headers } = await criarApp().request('/qualquer-coisa', {}, env);

    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Cache-Control')).toBeNull();
  });
});

describe('Cache-Control: no-store em /api/* (PUB-05)', () => {
  it('na resposta de sucesso', async () => {
    const { headers } = await criarApp().request('/api/health', {}, env);

    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('em rota inexistente de /api', async () => {
    const resposta = await criarApp().request('/api/nao-existe', {}, env);

    expect(resposta.status).toBe(404);
    expect(resposta.headers.get('Cache-Control')).toBe('no-store');
  });

  it('em erro não tratado (500) e com os cabeçalhos de segurança', async () => {
    const resposta = await appComRotaQueFalha().request('/api/falha', {}, env);

    expect(resposta.status).toBe(500);
    expect(resposta.headers.get('Cache-Control')).toBe('no-store');
    expect(resposta.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
