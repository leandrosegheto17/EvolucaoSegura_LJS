import { expect, test } from '@playwright/test';
import { cadastrarEConfirmar, completarPerfil, contaNova, entrarComCodigo } from './apoio/conta.ts';

// CAD-04, AUTH-04: cadastro, confirmação do e-mail e login com código (2FA) pela interface.
// Critério: a conta nova chega ao app com o trial de 14 dias.

const DIA_MS = 24 * 60 * 60 * 1000;

test('conta nova confirma o e-mail, entra com 2FA e chega ao app com o trial de 14 dias', async ({
  page,
  request,
}) => {
  const conta = contaNova('acesso');

  await cadastrarEConfirmar(page, request, conta);
  await expect(page.getByText('Seu teste grátis de 14 dias começou.')).toBeVisible();

  await entrarComCodigo(page, request, conta);
  // Conta nova ainda sem perfil: o app leva ao perfil (PERF-01) e depois libera o resto.
  await completarPerfil(page);

  // O plano da conta é o trial do Pro, que termina em 14 dias.
  const resposta = await page.request.get('/api/plano');
  expect(resposta.ok()).toBe(true);
  const plano = (await resposta.json()) as {
    plano: string;
    status: string;
    data: { tipo: string; em: string } | null;
  };
  expect(plano.plano).toBe('pro');
  expect(plano.status).toBe('trial');
  expect(plano.data?.tipo).toBe('fim');
  const dias = (new Date(plano.data!.em).getTime() - Date.now()) / DIA_MS;
  expect(dias).toBeGreaterThan(13);
  expect(dias).toBeLessThanOrEqual(14);

  // E a tela Meu plano mostra o período de teste.
  await page.goto('/app/plano');
  await expect(page.getByText('Período de teste do Pro')).toBeVisible();
});
