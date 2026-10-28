import { expect, test } from '@playwright/test';
import { esperarEmail, linkDoEmail } from './apoio/email.ts';

// OPS-05 (T158): a infraestrutura do e2e funciona. O Worker local responde, usa o Postgres, e o
// e-mail que ele enviaria ao Resend chega ao coletor do teste.

test('o Worker local responde e serve o app', async ({ request, page }) => {
  const saude = await request.get('/api/health');
  expect(saude.ok()).toBe(true);

  await page.goto('/');
  await expect(page.getByRole('link', { name: /começar grátis/i }).first()).toBeVisible();
});

test('o e-mail de confirmação do cadastro é capturado em teste', async ({ request }) => {
  const email = `infra-${Date.now()}@exemplo.com.br`;

  const resposta = await request.post('/api/cadastro', {
    data: {
      nome: 'Infra E2E',
      email,
      senha: 'uma frase longa de teste 4821',
      aceite_termos: true,
    },
  });
  expect(resposta.status()).toBe(202);

  const capturado = await esperarEmail(request, email, 'Confirme seu e-mail');
  expect(linkDoEmail(capturado)).toContain('/confirmar?token=');
});
