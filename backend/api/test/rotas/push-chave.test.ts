import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { esquemaChavePush } from '@es/contrato/push';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ipUnico, sessaoDeTeste } from '../apoio.ts';

// T179 / PUSH-01, PERF-08: GET /api/push/chave entrega ao navegador a chave pública VAPID
// (applicationServerKey do PushManager.subscribe), lida do ambiente (VAPID_PUBLIC_KEY), a mesma
// que assina os envios (T142). Sem as três chaves VAPID o push está desligado (T144): a rota
// responde chave null e a tela mostra o push indisponível. Autenticada, como as demais de push.

const app = criarApp({ capturarErro: () => {} });

const VAPID = {
  VAPID_PUBLIC_KEY: 'BOr4H2Cb1u2yP4yq8bBFq3vB9Yb3pU9n5B0kQ0yVq3C8',
  VAPID_PRIVATE_KEY: 'segredo-que-nunca-sai',
  VAPID_SUBJECT: 'mailto:contato@evolucaosegura.com.br',
};

async function pedir(sessao: Awaited<ReturnType<typeof sessaoDeTeste>> | null, ambiente = env) {
  return app.request(
    '/api/push/chave',
    {
      headers: {
        'CF-Connecting-IP': ipUnico(),
        ...(sessao ? { cookie: sessao.cookie } : {}),
      },
    },
    ambiente,
  );
}

describe('GET /api/push/chave', () => {
  it('sem sessão responde 401', async () => {
    const resposta = await pedir(null, { ...env, ...VAPID });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('com as chaves VAPID, devolve só a pública', async () => {
    const resposta = await pedir(await sessaoDeTeste(), { ...env, ...VAPID });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(esquemaChavePush.parse(corpo)).toEqual({ chave_publica: VAPID.VAPID_PUBLIC_KEY });
    expect(JSON.stringify(corpo)).not.toContain(VAPID.VAPID_PRIVATE_KEY);
  });

  it('sem alguma das chaves VAPID, o push está desligado: chave null', async () => {
    const sessao = await sessaoDeTeste();
    for (const falta of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const) {
      const ambiente = { ...env, ...VAPID, [falta]: undefined };
      const resposta = await pedir(sessao, ambiente);
      expect(resposta.status, falta).toBe(200);
      expect(await resposta.json(), falta).toEqual({ chave_publica: null });
    }
  });
});
