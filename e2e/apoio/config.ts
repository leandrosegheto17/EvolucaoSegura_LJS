import { resolve } from 'node:path';

// OPS-05: portas, bancos e segredos de teste do e2e. Tudo local; nada aqui é segredo de ambiente
// real. A chave do Asaas (sandbox) nunca fica em arquivo: vem de ASAAS_API_KEY no ambiente.

export const RAIZ = resolve(import.meta.dirname, '../..');
export const PORTA_WORKER = 8787;
export const PORTA_COLETOR = 8799;
export const URL_APP = `http://localhost:${PORTA_WORKER}`;
export const URL_COLETOR = `http://localhost:${PORTA_COLETOR}`;

// Banco próprio do e2e: não mistura com o dos testes de unidade (evolucao_segura).
export const BANCO_E2E = 'evolucao_segura_e2e';
// 127.0.0.1, não localhost: no Windows o localhost resolve primeiro para IPv6 e a conexão ao
// Postgres expira sem mensagem (T207). PG_PORTA troca a porta (padrão 5433, a do docker-compose).
export function urlsBancoE2e(env: Record<string, string | undefined>): {
  admin: string;
  app: string;
} {
  const porta = env['PG_PORTA'] || '5433';
  const n = Number(porta);
  if (!/^\d+$/.test(porta) || n < 1 || n > 65535)
    throw new Error(`PG_PORTA inválida: ${JSON.stringify(porta)} (use um número de 1 a 65535)`);
  const servidor = `127.0.0.1:${porta}/${BANCO_E2E}`;
  return {
    admin: `postgres://postgres:postgres@${servidor}`,
    app: `postgres://evolucao_app:evolucao_app@${servidor}`,
  };
}
const urls = urlsBancoE2e(process.env);
export const URL_BANCO_ADMIN = urls.admin;
export const URL_BANCO_APP = urls.app;

export const HMAC_2FA_SEGREDO = 'segredo-e2e-do-hmac-2fa-somente-local-32-ou-mais';
// Token do webhook só do ambiente local de teste (T186); o Worker o recebe por variável.
export const TOKEN_WEBHOOK = 'token-e2e-do-webhook-asaas-somente-local-32-ou-mais';
