import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';

// T143 / PUSH-01, PERF-08, ISO-02: POST e DELETE /api/push/assinatura. Ativar guarda a assinatura
// do dispositivo (PushSubscription.toJSON); o mesmo endpoint não duplica (só as chaves mudam);
// desativar remove. Outro profissional não remove nem toma a assinatura de A: o DELETE dele não
// muda nada e o POST com o endpoint de A responde 409 endpoint_em_uso (PREMISSA).

type Sessao = Awaited<ReturnType<typeof sessaoDeTeste>>;

const app = criarApp({ capturarErro: () => {} });

function pedir(metodo: 'POST' | 'DELETE', sessao: Sessao | null, corpo: unknown, csrf = true) {
  return app.request(
    '/api/push/assinatura',
    {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': ipUnico(),
        ...(sessao ? { cookie: sessao.cookie } : {}),
        ...(sessao && csrf ? { 'x-csrf-token': sessao.csrf } : {}),
      },
      body: JSON.stringify(corpo),
    },
    env,
  );
}

const novoEndpoint = () => `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
const inscricao = (
  endpoint: string,
  p256dh = 'BNcRdreALRFX_p256dh',
  auth = 'tBHItJI5svbpez7K',
) => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh, auth },
});

const linhas = (endpoint: string) =>
  comoAdmin<{ usuario_id: string; p256dh: string; auth: string }>(
    'select usuario_id, p256dh, auth from push_subscription where endpoint = $1',
    [endpoint],
  );

describe('exigem sessão e CSRF', () => {
  it('sem sessão responde 401 e nada é gravado', async () => {
    const endpoint = novoEndpoint();
    const resposta = await pedir('POST', null, inscricao(endpoint));
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(await linhas(endpoint)).toEqual([]);
    expect((await pedir('DELETE', null, { endpoint })).status).toBe(401);
  });

  it('sem x-csrf-token responde 403 e nada é gravado', async () => {
    const sessao = await sessaoDeTeste();
    const endpoint = novoEndpoint();
    expect((await pedir('POST', sessao, inscricao(endpoint), false)).status).toBe(403);
    expect(await linhas(endpoint)).toEqual([]);
  });
});

describe('ativar (PUSH-01)', () => {
  it('guarda a assinatura do dispositivo e responde 204', async () => {
    const sessao = await sessaoDeTeste();
    const endpoint = novoEndpoint();
    const resposta = await pedir('POST', sessao, inscricao(endpoint));
    expect(resposta.status).toBe(204);
    expect(await linhas(endpoint)).toEqual([
      { usuario_id: sessao.usuarioId, p256dh: 'BNcRdreALRFX_p256dh', auth: 'tBHItJI5svbpez7K' },
    ]);
  });

  it('o mesmo endpoint não duplica: a segunda ativação só troca as chaves', async () => {
    const sessao = await sessaoDeTeste();
    const endpoint = novoEndpoint();
    expect((await pedir('POST', sessao, inscricao(endpoint))).status).toBe(204);
    expect((await pedir('POST', sessao, inscricao(endpoint))).status).toBe(204);
    expect(await linhas(endpoint)).toHaveLength(1);
    expect((await pedir('POST', sessao, inscricao(endpoint, 'novaChave', 'novoAuth'))).status).toBe(
      204,
    );
    expect(await linhas(endpoint)).toEqual([
      { usuario_id: sessao.usuarioId, p256dh: 'novaChave', auth: 'novoAuth' },
    ]);
  });

  it('cada dispositivo (endpoint) do profissional tem a sua assinatura', async () => {
    const sessao = await sessaoDeTeste();
    const [um, dois] = [novoEndpoint(), novoEndpoint()];
    await pedir('POST', sessao, inscricao(um));
    await pedir('POST', sessao, inscricao(dois));
    expect(
      await comoAdmin('select count(*)::int as n from push_subscription where usuario_id = $1', [
        sessao.usuarioId,
      ]),
    ).toEqual([{ n: 2 }]);
  });

  it('aceita a inscrição sem expirationTime', async () => {
    const sessao = await sessaoDeTeste();
    const endpoint = novoEndpoint();
    const semValidade = { endpoint, keys: inscricao(endpoint).keys };
    expect((await pedir('POST', sessao, semValidade)).status).toBe(204);
    expect(await linhas(endpoint)).toHaveLength(1);
  });

  it.each([
    ['endpoint http', { ...inscricao('http://push.exemplo.com/x') }],
    ['sem chaves', { endpoint: 'https://push.exemplo.com/x' }],
    ['chave fora de base64url', inscricao('https://push.exemplo.com/x', 'a+b/', 'auth')],
    ['campo desconhecido', { ...inscricao('https://push.exemplo.com/x'), usuario_id: 'x' }],
  ])('recusa %s com 422 validacao e não grava', async (_rotulo, corpo) => {
    const sessao = await sessaoDeTeste();
    const resposta = await pedir('POST', sessao, corpo);
    expect(resposta.status).toBe(422);
    expect(((await resposta.json()) as { codigo: string }).codigo).toBe('validacao');
    expect(
      await comoAdmin('select 1 from push_subscription where usuario_id = $1', [sessao.usuarioId]),
    ).toEqual([]);
  });
});

describe('desativar (PUSH-01)', () => {
  it('remove a assinatura do endpoint e responde 204; as outras ficam', async () => {
    const sessao = await sessaoDeTeste();
    const [este, outro] = [novoEndpoint(), novoEndpoint()];
    await pedir('POST', sessao, inscricao(este));
    await pedir('POST', sessao, inscricao(outro));
    const resposta = await pedir('DELETE', sessao, { endpoint: este });
    expect(resposta.status).toBe(204);
    expect(await linhas(este)).toEqual([]);
    expect(await linhas(outro)).toHaveLength(1);
  });

  it('desativar de novo (nada a remover) responde 204', async () => {
    const sessao = await sessaoDeTeste();
    expect((await pedir('DELETE', sessao, { endpoint: novoEndpoint() })).status).toBe(204);
  });

  it('recusa corpo inválido com 422', async () => {
    const sessao = await sessaoDeTeste();
    expect((await pedir('DELETE', sessao, { endpoint: 'nao-e-url' })).status).toBe(422);
  });
});

describe('isolamento (ISO-02)', () => {
  it('B não remove a assinatura de A', async () => {
    const [a, b] = [await sessaoDeTeste(), await sessaoDeTeste()];
    const endpoint = novoEndpoint();
    await pedir('POST', a, inscricao(endpoint));
    expect((await pedir('DELETE', b, { endpoint })).status).toBe(204);
    expect(await linhas(endpoint)).toEqual([
      { usuario_id: a.usuarioId, p256dh: 'BNcRdreALRFX_p256dh', auth: 'tBHItJI5svbpez7K' },
    ]);
  });

  it('B não toma nem altera a assinatura de A: 409 endpoint_em_uso', async () => {
    const [a, b] = [await sessaoDeTeste(), await sessaoDeTeste()];
    const endpoint = novoEndpoint();
    await pedir('POST', a, inscricao(endpoint));
    const resposta = await pedir('POST', b, inscricao(endpoint, 'chaveDeB', 'authDeB'));
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({
      tipo: 'about:blank',
      titulo: 'Este dispositivo já recebe notificações de outra conta',
      status: 409,
      codigo: 'endpoint_em_uso',
    });
    expect(await linhas(endpoint)).toEqual([
      { usuario_id: a.usuarioId, p256dh: 'BNcRdreALRFX_p256dh', auth: 'tBHItJI5svbpez7K' },
    ]);
  });
});
