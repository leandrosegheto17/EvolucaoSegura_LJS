import { describe, expect, it, vi } from 'vitest';
import {
  TAMANHO_LOTE_PUSH,
  type EnvioPush,
  enviarEmLotes,
} from '../../src/integracoes/push-lotes.ts';
import type { AssinaturaPush } from '../../src/integracoes/push.ts';

// T177 / PUSH-07 (ADR-011): o envio de vários pushes vai em lotes, em segundo plano pelo
// ctx.waitUntil (emSegundoPlano). Lote de 6 envios simultâneos (limite de conexões de saída de uma
// execução do Worker); os lotes seguem um depois do outro. Um envio com erro não impede os demais
// e vai a capturarErro. O serviço de push é simulado por fetch.

const AGORA = new Date('2026-11-10T17:00:00.000Z');
const MENSAGEM = { titulo: 'Sessão próxima', corpo: 'Você tem uma sessão às 14:00.', url: '/app' };

const base64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

async function vapid() {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', par.privateKey)) as JsonWebKey;
  const crua = (await crypto.subtle.exportKey('raw', par.publicKey)) as ArrayBuffer;
  return { chavePublica: base64url(crua), chavePrivada: jwk.d!, assunto: 'mailto:a@b.com.br' };
}

async function envios(n: number): Promise<EnvioPush[]> {
  const par = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const p256dh = base64url((await crypto.subtle.exportKey('raw', par.publicKey)) as ArrayBuffer);
  const auth = base64url(crypto.getRandomValues(new Uint8Array(16)));
  return Array.from({ length: n }, (_, i) => ({
    assinatura: {
      id: `id-${i}`,
      usuarioId: 'u',
      endpoint: `https://fcm.googleapis.com/fcm/send/${i}`,
      p256dh,
      auth,
    } satisfies AssinaturaPush,
    mensagem: MENSAGEM,
  }));
}

// Serviço de push que segura cada resposta até `liberar` e mede quantos envios estão abertos.
function servicoControlado(status = 201) {
  let abertos = 0;
  let pico = 0;
  const pendentes: (() => void)[] = [];
  const chamadas: string[] = [];
  const fn = (async (url: RequestInfo | URL) => {
    chamadas.push(String(url));
    abertos += 1;
    pico = Math.max(pico, abertos);
    await new Promise<void>((resolver) => pendentes.push(resolver));
    abertos -= 1;
    return new Response(null, { status });
  }) as typeof fetch;
  // Libera as respostas em rodadas até as `total` chamadas terem chegado e respondido (os lotes
  // seguintes só chegam depois que o anterior responde).
  const liberarAte = async (total: number) => {
    for (let rodada = 0; rodada < 400; rodada++) {
      await new Promise((r) => setTimeout(r, 5));
      pendentes.splice(0).forEach((liberar) => liberar());
      if (chamadas.length === total && pendentes.length === 0 && abertos === 0) return;
    }
    throw new Error(`liberarAte: ${chamadas.length} de ${total} chamadas`);
  };
  return { fn, chamadas, pendentes, liberarAte, pico: () => pico };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('envio em lotes com ctx.waitUntil (PUSH-07)', () => {
  it('entrega o trabalho ao waitUntil e não espera os envios terminarem', async () => {
    const servico = servicoControlado();
    const emSegundoPlano = vi.fn();
    const promessa = enviarEmLotes(await envios(3), {
      vapid: await vapid(),
      agora: AGORA,
      fetch: servico.fn,
      removerAssinatura: async () => {},
      emSegundoPlano,
      capturarErro: () => {},
    });
    expect(emSegundoPlano).toHaveBeenCalledTimes(1);
    expect(emSegundoPlano.mock.calls[0]![0]).toBe(promessa);
    await esperar(50);
    expect(servico.pendentes.length).toBe(3); // ainda em andamento
    await servico.liberarAte(3);
    expect(await promessa).toEqual(['enviado', 'enviado', 'enviado']);
  });

  it('no máximo 6 envios ao mesmo tempo; os lotes seguem um depois do outro', async () => {
    expect(TAMANHO_LOTE_PUSH).toBe(6);
    const servico = servicoControlado();
    const promessa = enviarEmLotes(await envios(14), {
      vapid: await vapid(),
      agora: AGORA,
      fetch: servico.fn,
      removerAssinatura: async () => {},
      emSegundoPlano: () => {},
      capturarErro: () => {},
    });
    await esperar(50);
    // Só o primeiro lote começou.
    expect(servico.chamadas).toHaveLength(6);
    await servico.liberarAte(14);
    const resultados = await promessa;
    expect(resultados).toHaveLength(14);
    expect(resultados.every((r) => r === 'enviado')).toBe(true);
    expect(servico.chamadas).toHaveLength(14);
    expect(servico.pico()).toBe(6);
  });

  it('um envio com erro não impede os demais e vai a capturarErro', async () => {
    const lista = await envios(4);
    const erro = new Error('banco fora');
    const capturarErro = vi.fn();
    const resultados = await enviarEmLotes(lista, {
      vapid: await vapid(),
      agora: AGORA,
      fetch: (async (url: RequestInfo | URL) =>
        new Response(null, { status: String(url).endsWith('/1') ? 410 : 201 })) as typeof fetch,
      removerAssinatura: async () => {
        throw erro;
      },
      emSegundoPlano: () => {},
      capturarErro,
    });
    expect(resultados).toEqual(['enviado', 'erro', 'enviado', 'enviado']);
    expect(capturarErro).toHaveBeenCalledExactlyOnceWith(erro);
  });

  it('sem envios, termina sem chamar o serviço', async () => {
    const servico = servicoControlado();
    const resultados = await enviarEmLotes([], {
      vapid: await vapid(),
      agora: AGORA,
      fetch: servico.fn,
      removerAssinatura: async () => {},
      emSegundoPlano: () => {},
      capturarErro: () => {},
    });
    expect(resultados).toEqual([]);
    expect(servico.chamadas).toEqual([]);
  });
});
