import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
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

// O binding simulado do miniflare conta em janelas alinhadas ao relógio (epoch = Date.now() / 60 s)
// e zera os contadores na virada do minuto. Rajada que atravessa a virada recomeça do zero e o 429
// esperado vira 200 (falha intermitente). Perto da virada, cada teste espera o minuto seguinte.
const FOLGA_ANTES_DA_VIRADA_MS = 5_000;
beforeEach(async () => {
  const restante = 60_000 - (Date.now() % 60_000);
  if (restante < FOLGA_ANTES_DA_VIRADA_MS)
    await new Promise((pronto) => setTimeout(pronto, restante + 50));
});

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

// SEC-003 (T215): o grupo sai do caminho já roteado (decodificado), não do pathname cru da URL.
// Com um binding que sempre nega, toda variante que chega ao handler de uma rota limitada é 429.
describe('caminho com percent-encoding (SEC-003)', () => {
  const nega = { limit: async () => ({ success: false }) };
  const envQueNega = {
    ...env,
    LIMITE_ACESSO: nega,
    LIMITE_PUBLICO: nega,
    LIMITE_WEBHOOK: nega,
  } as unknown as Cloudflare.Env;

  // Mesmo roteamento do app: o handler só responde nas rotas exatas, como as rotas reais.
  const appRoteado = new Hono<{ Bindings: Cloudflare.Env }>();
  appRoteado.use('/api/*', limitePorIp);
  for (const rota of ['/api/auth/entrar', '/api/cadastro', '/api/cadastro/confirmar'])
    appRoteado.post(rota, (c) => c.json({ ok: true, rota }));
  appRoteado.post('/api/webhooks/asaas', (c) => c.json({ ok: true }));
  appRoteado.post('/api/pacientes', (c) => c.json({ ok: true }));

  const pedirNegado = (caminho: string) =>
    appRoteado.request(
      caminho,
      { method: 'POST', headers: { 'CF-Connecting-IP': novoIp() } },
      envQueNega,
    );

  it.each([
    ['/api/auth/entrar', '/api/auth/%65ntrar'],
    ['/api/auth/entrar', '/api/auth/%65%6E%74%72%61%72'],
    ['/api/cadastro', '/api/cadastr%6F'],
    ['/api/cadastro', '/api/%63adastro'],
    ['/api/cadastro/confirmar', '/api/cadastro/confirma%72'],
    ['/api/webhooks/asaas', '/api/webhooks/%61saas'],
  ])('%s e a variante %s recebem 429 do binding que sempre nega', async (normal, variante) => {
    const respostaNormal = await pedirNegado(normal);
    const respostaVariante = await pedirNegado(variante);

    expect(respostaNormal.status).toBe(429);
    expect(respostaVariante.status).toBe(429);
    expect(await respostaVariante.json()).toMatchObject({ codigo: 'muitas_tentativas' });
  });

  it('a variante codificada chega ao handler da rota quando o binding deixa passar', async () => {
    const resposta = await appRoteado.request(
      '/api/auth/%65ntrar',
      { method: 'POST', headers: { 'CF-Connecting-IP': novoIp() } },
      env,
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true, rota: '/api/auth/entrar' });
  });

  it('rota autenticada codificada continua sem limite por IP', async () => {
    expect((await pedirNegado('/api/p%61cientes')).status).toBe(200);
  });

  it.each(['/api/auth/%zzntrar', '/api/auth/entrar%', '/api/cadastr%6', '/api/cadastro%E0'])(
    '%s (percent-encoding inválido) recebe 400 sem chamar o binding',
    async (caminho) => {
      let chamadas = 0;
      const contaChamadas = {
        limit: async () => {
          chamadas += 1;
          return { success: true };
        },
      };
      const resposta = await appRoteado.request(
        caminho,
        { method: 'POST', headers: { 'CF-Connecting-IP': novoIp() } },
        {
          ...env,
          LIMITE_ACESSO: contaChamadas,
          LIMITE_PUBLICO: contaChamadas,
          LIMITE_WEBHOOK: contaChamadas,
        } as unknown as Cloudflare.Env,
      );

      expect(resposta.status).toBe(400);
      expect(resposta.headers.get('content-type')).toContain('application/problem+json');
      expect(await resposta.json()).toMatchObject({ status: 400, codigo: 'caminho_invalido' });
      expect(chamadas).toBe(0);
    },
  );

  it('% válido em rota fora dos grupos não é recusado', async () => {
    expect((await pedirNegado('/api/pacientes?q=Jo%C3%A3o')).status).toBe(200);
  });

  it('no app real, a variante codificada de entrar também é barrada', async () => {
    const resposta = await criarApp().request(
      '/api/auth/%65ntrar',
      { method: 'POST', headers: { 'CF-Connecting-IP': novoIp() } },
      envQueNega,
    );

    expect(resposta.status).toBe(429);
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
