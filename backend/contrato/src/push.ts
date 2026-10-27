import { z } from 'zod';
import type { Problema } from './identidade.ts';

// PUSH-01, PERF-08: contrato de POST e DELETE /api/push/assinatura, a ativação e a desativação do
// push por dispositivo. O corpo do POST é o PushSubscription.toJSON() do navegador ({endpoint,
// expirationTime, keys: {p256dh, auth}}); o do DELETE, só o endpoint. Os limites são os da
// migration 0017: endpoint https de até 2048 caracteres, chaves em base64url. Corpo estrito:
// chave desconhecida responde 422.

const endpoint = z
  .string()
  .max(2048)
  .regex(/^https:\/\/\S+$/);
const chave = (maximo: number) =>
  z
    .string()
    .max(maximo)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const esquemaAtivarPush = z.strictObject({
  endpoint,
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({ p256dh: chave(200), auth: chave(100) }),
});
export type AtivarPush = z.output<typeof esquemaAtivarPush>;

export const esquemaDesativarPush = z.strictObject({ endpoint });
export type DesativarPush = z.output<typeof esquemaDesativarPush>;

// PREMISSA: o endpoint já está ativo para outro profissional (o mesmo navegador usado por duas
// contas). A assinatura de um não passa para o outro sem que o primeiro desative.
export const PROBLEMA_ENDPOINT_EM_USO: Problema = {
  tipo: 'about:blank',
  titulo: 'Este dispositivo já recebe notificações de outra conta',
  status: 409,
  codigo: 'endpoint_em_uso',
};
