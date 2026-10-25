import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.ts';
import { grupoDaRota, limitePorIp } from '../src/middleware/limite.ts';

// T43 / OPS-07 (ADR-006): limite por IP com o binding `ratelimits` do Worker. 10 por minuto em
// entrar, 2FA, cadastro e recuperação; 60 por minuto nas demais rotas públicas; o webhook tem o
// próprio limite. Acima do limite, 429. Cada grupo tem o seu contador.
// O spike rate-limit-free mediu limite efetivo de ±1 no Free, e o binding dos testes é o simulado
// do miniflare: as asserções aceitam um passe a mais e nunca dependem do número exato.

let ipSequencial = 0;
// IP novo a cada teste: os contadores do binding duram o minuto inteiro.
const novoIp = () => {
  ipSequencial += 1;
  return `198.51.${Math.floor(ipSequencial / 250)}.${ipSequencial % 250}`;
};

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.use('/api/*', limitePorIp);
app.all('/api/*', (c) => c.json({ ok: true }));

async function pedir(caminho: string, ip: string, metodo = 'POST'): Promise<number> {
  const resposta = await app.request(
    caminho,
    { method: metodo, headers: { 'CF-Connecting-IP': ip } },
    env,
  );
  return resposta.status;
}

async function rajada(caminho: string, ip: string, total: number): Promise<number[]> {
  const status: number[] = [];
  for (let i = 0; i < total; i += 1) status.push(await pedir(caminho, ip));
  return status;
}

// Quantas passaram antes do primeiro 429, e se depois dele todas foram 429.
function resumo(status: number[]) {
  const primeiro429 = status.indexOf(429);
  return {
    passes: primeiro429 === -1 ? status.length : primeiro429,
    todasDepoisSao429: primeiro429 !== -1 && status.slice(primeiro429).every((s) => s === 429),
    soDoisStatus: status.every((s) => s === 200 || s === 429),
  };
}

describe('grupos de rota', () => {
  it.each([
    ['/api/cadastro', 'acesso'],
    ['/api/auth/entrar', 'acesso'],
    ['/api/auth/2fa/verificar', 'acesso'],
    ['/api/auth/2fa/reenviar', 'acesso'],
    ['/api/auth/recuperar', 'acesso'],
    ['/api/auth/recuperar/confirmar', 'acesso'],
    ['/api/cadastro/confirmar', 'publico'],
    ['/api/webhooks/asaas', 'webhook'],
  ])('%s fica no grupo %s', (caminho, grupo) => {
    expect(grupoDaRota(caminho)).toBe(grupo);
  });

  it('rota autenticada e o health (monitoramento) não têm limite por IP', () => {
    expect(grupoDaRota('/api/health')).toBeNull();
    expect(grupoDaRota('/api/auth/sair')).toBeNull();
    expect(grupoDaRota('/api/pacientes')).toBeNull();
  });
});

describe('limite de 10 por minuto em entrar, 2FA, cadastro e recuperação', () => {
  it('a 11ª requisição no minuto recebe 429 (tolerância de ±1 do binding)', async () => {
    const r = resumo(await rajada('/api/auth/entrar', novoIp(), 14));
    expect(r.passes).toBeGreaterThanOrEqual(10);
    expect(r.passes).toBeLessThanOrEqual(11);
    expect(r.todasDepoisSao429).toBe(true);
    expect(r.soDoisStatus).toBe(true);
  });

  it('as rotas de acesso dividem o mesmo contador', async () => {
    const ip = novoIp();
    await rajada('/api/cadastro', ip, 4);
    await rajada('/api/auth/2fa/verificar', ip, 4);
    await rajada('/api/auth/recuperar', ip, 4);
    expect(await pedir('/api/auth/entrar', ip)).toBe(429);
  });

  it('o 429 vem como problem+json muitas_tentativas', async () => {
    const ip = novoIp();
    await rajada('/api/cadastro', ip, 12);
    const resposta = await app.request(
      '/api/cadastro',
      { method: 'POST', headers: { 'CF-Connecting-IP': ip } },
      env,
    );
    expect(resposta.status).toBe(429);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toEqual({
      tipo: 'about:blank',
      titulo: 'Muitas requisições',
      status: 429,
      codigo: 'muitas_tentativas',
    });
  });
});

describe('limite de 60 por minuto nas demais rotas públicas', () => {
  it('passam 60 (ou 61) e as seguintes recebem 429', async () => {
    const r = resumo(await rajada('/api/cadastro/confirmar', novoIp(), 64));
    expect(r.passes).toBeGreaterThanOrEqual(60);
    expect(r.passes).toBeLessThanOrEqual(61);
    expect(r.todasDepoisSao429).toBe(true);
  });
});

describe('limite do webhook', () => {
  it('tem contador e limite próprios, acima dos 60 das rotas públicas', async () => {
    const r = resumo(await rajada('/api/webhooks/asaas', novoIp(), 124));
    expect(r.passes).toBeGreaterThanOrEqual(120);
    expect(r.passes).toBeLessThanOrEqual(121);
    expect(r.todasDepoisSao429).toBe(true);
  });
});

describe('contadores separados', () => {
  it('estourar o grupo de acesso não afeta as demais rotas públicas nem o webhook', async () => {
    const ip = novoIp();
    await rajada('/api/auth/entrar', ip, 12);
    expect(await pedir('/api/auth/entrar', ip)).toBe(429);
    expect(await pedir('/api/cadastro/confirmar', ip)).toBe(200);
    expect(await pedir('/api/webhooks/asaas', ip)).toBe(200);
  });

  it('estourar as demais rotas públicas não afeta o grupo de acesso', async () => {
    const ip = novoIp();
    await rajada('/api/cadastro/confirmar', ip, 62);
    expect(await pedir('/api/cadastro/confirmar', ip)).toBe(429);
    expect(await pedir('/api/auth/entrar', ip)).toBe(200);
  });

  it('cada IP tem o seu contador', async () => {
    const ip = novoIp();
    await rajada('/api/auth/entrar', ip, 12);
    expect(await pedir('/api/auth/entrar', ip)).toBe(429);
    expect(await pedir('/api/auth/entrar', novoIp())).toBe(200);
  });

  it('rota autenticada não consome nem é barrada pelo limite', async () => {
    const ip = novoIp();
    const status = await rajada('/api/pacientes', ip, 15);
    expect(status.every((s) => s === 200)).toBe(true);
  });
});

describe('no Worker', () => {
  it('o app aplica o limite antes das rotas, com os cabeçalhos de segurança', async () => {
    const ip = novoIp();
    const appReal = criarApp();
    let ultima: Response | undefined;
    for (let i = 0; i < 12; i += 1)
      ultima = await appReal.request(
        '/api/auth/entrar',
        { method: 'POST', headers: { 'CF-Connecting-IP': ip } },
        env,
      );
    expect(ultima?.status).toBe(429);
    expect(ultima?.headers.get('cache-control')).toBe('no-store');
  });
});
