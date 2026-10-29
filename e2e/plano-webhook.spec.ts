import { expect, test } from '@playwright/test';
import { idsAsaasDaConta } from './apoio/banco.ts';
import { TOKEN_WEBHOOK } from './apoio/config.ts';
import { assinarPro, criarContaLogada } from './apoio/conta.ts';

// PLANO-08: depois do webhook de pagamento, o plano aparece como ativo. O webhook é simulado
// chamando a rota real do Worker local com o token de teste (TOKEN_WEBHOOK, só deste ambiente
// local). O Worker consulta a assinatura no sandbox do Asaas (ASAAS_API_KEY do ambiente) para
// achar o próximo vencimento.

test('o webhook de pagamento deixa o plano como Pro ativo', async ({ page, request }) => {
  test.setTimeout(120_000);
  // Sem a chave do sandbox, pulado de forma explícita (T208); o teste do token errado roda sempre.
  test.skip(!process.env['ASAAS_API_KEY'], 'ASAAS_API_KEY ausente: sem o sandbox do Asaas');
  const conta = await criarContaLogada(page, request, 'webhook');
  await assinarPro(page, conta);
  await expect(page.getByText('Período de teste do Pro')).toBeVisible();

  const { assinatura, cliente } = await idsAsaasDaConta(conta.email);
  const resposta = await request.post('/api/webhooks/asaas', {
    headers: { 'asaas-access-token': TOKEN_WEBHOOK },
    data: {
      id: `evt_e2e_${Date.now()}&1`,
      event: 'PAYMENT_RECEIVED',
      payment: { id: `pay_e2e_${Date.now()}`, subscription: assinatura, customer: cliente },
    },
  });
  expect(resposta.status()).toBe(200);

  await page.goto('/app/plano');
  await expect(page.getByText('Pro ativo')).toBeVisible();
  await expect(page.getByText(/^Renovação em \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
});

test('o webhook sem o token correto é recusado', async ({ request }) => {
  const resposta = await request.post('/api/webhooks/asaas', {
    headers: { 'asaas-access-token': 'token-errado' },
    data: { id: 'evt_e2e_recusado&1', event: 'PAYMENT_RECEIVED' },
  });
  expect(resposta.status()).toBe(401);
});
