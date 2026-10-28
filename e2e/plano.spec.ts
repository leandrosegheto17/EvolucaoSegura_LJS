import { expect, test } from '@playwright/test';
import { CPF_DE_TESTE, criarContaLogada } from './apoio/conta.ts';

// PLANO-05: assinar o Pro no sandbox do Asaas (de verdade, com ASAAS_API_KEY do ambiente) e ver o
// Pix e o QR code em "Meu plano".

test('assina o Pro no sandbox e vê o Pix e o QR code', async ({ page, request }) => {
  test.setTimeout(120_000);
  // Sem a chave do sandbox o teste falha de propósito (não é pulado): o Pix não pode ser provado.
  expect(process.env['ASAAS_API_KEY'], 'defina ASAAS_API_KEY (sandbox) no ambiente').toBeTruthy();
  const conta = await criarContaLogada(page, request, 'plano');

  await page.goto('/app/plano');
  await expect(page.getByText('Período de teste do Pro')).toBeVisible();
  await page.getByLabel('Nome completo').fill(conta.nome);
  await page.getByLabel('CPF ou CNPJ').fill(CPF_DE_TESTE);
  await page.getByRole('button', { name: 'Assinar', exact: true }).click();

  const secaoPix = page.getByRole('region', { name: 'Pagamento por Pix' });
  await expect(secaoPix).toBeVisible({ timeout: 45_000 });
  await expect(secaoPix.getByAltText('QR code do Pix')).toBeVisible();
  await expect(secaoPix.getByLabel('Pix copia e cola')).not.toHaveValue('');
});
