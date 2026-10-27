import { describe, expect, it } from 'vitest';
import { esquemaAtivarPush, esquemaChavePush, esquemaDesativarPush } from './push.ts';

// T143 / PUSH-01: contrato da ativação e da desativação do push. O corpo de ativar é o
// PushSubscription.toJSON() do navegador; os limites são os da migration 0017 (endpoint https de
// até 2048 caracteres, chaves base64url de até 200 e 100). Chave desconhecida é recusada.

const ok = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc:APA91b',
  expirationTime: null,
  keys: { p256dh: 'BNcRdreALRFX_p256dh-x', auth: 'tBHItJI5svbpez7K' },
};
const aceita = (corpo: unknown) => esquemaAtivarPush.safeParse(corpo).success;

describe('ativar push (PUSH-01)', () => {
  it('aceita o PushSubscription.toJSON(), com ou sem expirationTime', () => {
    expect(esquemaAtivarPush.parse(ok)).toEqual(ok);
    const sem = { endpoint: ok.endpoint, keys: ok.keys };
    expect(aceita(sem)).toBe(true);
    expect(aceita({ ...ok, expirationTime: 1_800_000_000_000 })).toBe(true);
  });

  it('limites do endpoint: https, sem espaço, até 2048 caracteres', () => {
    const prefixo = 'https://push.exemplo.com/';
    expect(aceita({ ...ok, endpoint: prefixo + 'x'.repeat(2048 - prefixo.length) })).toBe(true);
    expect(aceita({ ...ok, endpoint: prefixo + 'x'.repeat(2049 - prefixo.length) })).toBe(false);
    for (const endpoint of ['http://push.exemplo.com/x', 'https://', 'https://a b', '', 1])
      expect(aceita({ ...ok, endpoint }), String(endpoint)).toBe(false);
  });

  it('limites das chaves: base64url, p256dh até 200 e auth até 100', () => {
    expect(aceita({ ...ok, keys: { p256dh: 'a'.repeat(200), auth: 'b'.repeat(100) } })).toBe(true);
    expect(aceita({ ...ok, keys: { p256dh: 'a'.repeat(201), auth: 'b' } })).toBe(false);
    expect(aceita({ ...ok, keys: { p256dh: 'a', auth: 'b'.repeat(101) } })).toBe(false);
    for (const keys of [
      { p256dh: '', auth: 'b' },
      { p256dh: 'a', auth: '' },
      { p256dh: 'a+b/', auth: 'b' },
      { p256dh: 'a' },
      { p256dh: 'a', auth: 'b', extra: 'c' },
    ])
      expect(aceita({ ...ok, keys }), JSON.stringify(keys)).toBe(false);
  });

  it('recusa chave desconhecida e corpo que não é objeto', () => {
    expect(aceita({ ...ok, usuario_id: 'x' })).toBe(false);
    for (const ruim of [null, [], 'x', {}]) expect(aceita(ruim), JSON.stringify(ruim)).toBe(false);
  });
});

describe('desativar push (PUSH-01)', () => {
  it('só o endpoint, com os mesmos limites', () => {
    expect(esquemaDesativarPush.parse({ endpoint: ok.endpoint })).toEqual({
      endpoint: ok.endpoint,
    });
    expect(esquemaDesativarPush.safeParse({ endpoint: 'http://x' }).success).toBe(false);
    expect(esquemaDesativarPush.safeParse({ endpoint: ok.endpoint, keys: ok.keys }).success).toBe(
      false,
    );
  });
});

// T179 / PUSH-01, PERF-08: resposta de GET /api/push/chave, a chave pública VAPID (base64url) que
// o navegador usa no PushManager.subscribe; null quando o push está desligado no servidor.
describe('chave pública do push (PUSH-01)', () => {
  it('aceita a chave base64url ou null', () => {
    const chave = 'BOr4H2Cb1u2yP4yq8bBFq3vB9Yb3pU9n5B0kQ0yVq3C8';
    expect(esquemaChavePush.parse({ chave_publica: chave })).toEqual({ chave_publica: chave });
    expect(esquemaChavePush.parse({ chave_publica: null })).toEqual({ chave_publica: null });
  });

  it('recusa chave fora de base64url, ausente, ou campo a mais', () => {
    for (const corpo of [
      { chave_publica: 'a b' },
      { chave_publica: '' },
      { chave_publica: 'x'.repeat(201) },
      {},
      { chave_publica: null, privada: 'x' },
    ])
      expect(esquemaChavePush.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
  });
});
