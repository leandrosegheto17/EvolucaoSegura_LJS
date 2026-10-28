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
export const URL_BANCO_ADMIN = `postgres://postgres:postgres@localhost:5433/${BANCO_E2E}`;
export const URL_BANCO_APP = `postgres://app:app@localhost:5433/${BANCO_E2E}`;

export const HMAC_2FA_SEGREDO = 'segredo-e2e-do-hmac-2fa-somente-local-32-ou-mais';
// Token do webhook só do ambiente local de teste (T186); o Worker o recebe por variável.
export const TOKEN_WEBHOOK = 'token-e2e-do-webhook-asaas-somente-local-32-ou-mais';
