import { encryptNotification } from '@block65/webcrypto-web-push';
import { sql } from 'kysely';
import { comTransacao } from '../db.ts';
import { cabecalhoAutorizacaoVapid } from './push-vapid.ts';

// PUSH-06, PUSH-07 (AD-004; spike push-worker): envio de um push cifrado a uma assinatura.
// - Da biblioteca @block65/webcrypto-web-push usa-se só a cifra (encryptNotification, RFC 8291,
//   aes128gcm, Web Crypto). O Authorization é o JWT VAPID próprio, sem iat (push-vapid.ts, T142):
//   o da biblioteca leva iat e o FCM o recusa.
// - A mensagem vai cifrada como JSON {titulo, corpo, url}; o service worker abre a url
//   (PUSH-08). Quem monta a mensagem não põe nome de paciente nem texto clínico (PUSH-05).
// - PUSH-06: 404 ou 410 do serviço removem a assinatura (removerAssinatura). 201 não prova
//   entrega (spike); qualquer outra resposta ou erro de rede devolve 'falha' sem remover nem
//   lançar, para um envio ruim não derrubar os demais.

// PREMISSA: 1 hora de validade no serviço de push, quando quem envia não pede outra.
export const TTL_PADRAO_S = 60 * 60;

export interface AssinaturaPush {
  id: string;
  usuarioId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface MensagemPush {
  titulo: string;
  corpo: string;
  url: string;
}

export interface ConfigVapid {
  chavePublica: string;
  chavePrivada: string;
  assunto: string;
}

export type ResultadoEnvioPush = 'enviado' | 'assinatura_removida' | 'falha';

export interface OpcoesEnvioPush {
  vapid: ConfigVapid;
  agora: Date;
  removerAssinatura: (assinatura: AssinaturaPush) => Promise<void>;
  ttlSegundos?: number;
  fetch?: typeof fetch;
}

const ASSINATURA_MORTA = new Set([404, 410]);

export async function enviarPush(
  assinatura: AssinaturaPush,
  mensagem: MensagemPush,
  opcoes: OpcoesEnvioPush,
): Promise<ResultadoEnvioPush> {
  const corpo = await encryptNotification(
    {
      endpoint: assinatura.endpoint,
      expirationTime: null,
      keys: { p256dh: assinatura.p256dh, auth: assinatura.auth },
    },
    new TextEncoder().encode(JSON.stringify(mensagem)),
  );
  const autorizacao = await cabecalhoAutorizacaoVapid({
    endpoint: assinatura.endpoint,
    assunto: opcoes.vapid.assunto,
    chavePublica: opcoes.vapid.chavePublica,
    chavePrivada: opcoes.vapid.chavePrivada,
    agora: opcoes.agora,
  });
  let status: number;
  try {
    const resposta = await (opcoes.fetch ?? fetch)(assinatura.endpoint, {
      method: 'POST',
      headers: {
        authorization: autorizacao,
        ttl: String(opcoes.ttlSegundos ?? TTL_PADRAO_S),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
      },
      body: corpo,
    });
    status = resposta.status;
  } catch {
    return 'falha';
  }
  if (ASSINATURA_MORTA.has(status)) {
    await opcoes.removerAssinatura(assinatura);
    return 'assinatura_removida';
  }
  return status >= 200 && status < 300 ? 'enviado' : 'falha';
}

// Remove a assinatura numa transação do próprio dono (RLS da push_subscription; a app tem
// DELETE nela, migration 0017). Serve ao cron, que não tem sessão.
export const removerAssinaturaMorta =
  (env: Pick<Cloudflare.Env, 'HYPERDRIVE'>) =>
  async (assinatura: AssinaturaPush): Promise<void> => {
    await comTransacao(env, assinatura.usuarioId, (trx) =>
      sql`delete from push_subscription where id = ${assinatura.id}`.execute(trx),
    );
  };
