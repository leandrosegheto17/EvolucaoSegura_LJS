import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { codigoDoEmail, esperarEmail, linkDoEmail } from './email.ts';

// OPS-05: passos de conta compartilhados pelos specs. Tudo pela interface, como a pessoa usa; só
// o e-mail vem do coletor (no lugar da caixa de entrada).

export const SENHA = 'uma frase longa de teste 4821';

export interface Conta {
  email: string;
  nome: string;
  senha: string;
}

let contador = 0;
export function contaNova(prefixo: string): Conta {
  contador += 1;
  return {
    email: `${prefixo}-${Date.now()}-${contador}@exemplo.com.br`,
    nome: 'Profissional E2E',
    senha: SENHA,
  };
}

// CAD-01, CAD-04: cadastra, abre o link do e-mail e vê a confirmação.
export async function cadastrarEConfirmar(
  page: Page,
  request: APIRequestContext,
  conta: Conta,
): Promise<void> {
  await page.goto('/cadastro');
  await page.getByLabel('Nome').fill(conta.nome);
  await page.getByLabel('E-mail').fill(conta.email);
  await page.getByLabel('Senha').fill(conta.senha);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText('Enviamos um link de confirmação')).toBeVisible();

  const confirmacao = await esperarEmail(request, conta.email, 'Confirme seu e-mail');
  await page.goto(linkDoEmail(confirmacao));
  await expect(page.getByText(/E-mail confirmado\./)).toBeVisible();
}

// AUTH-04: e-mail e senha, depois o código de 6 dígitos que chegou por e-mail.
export async function entrarComCodigo(
  page: Page,
  request: APIRequestContext,
  conta: Conta,
): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(conta.email);
  await page.getByLabel('Senha').fill(conta.senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Código de acesso' })).toBeVisible();

  const email = await esperarEmail(request, conta.email, 'código');
  await page.getByLabel('Código').fill(codigoDoEmail(email));
  await page.getByRole('button', { name: 'Confirmar código' }).click();
  await expect(page).toHaveURL(/\/app/);
}

// PERF-01: conta nova só usa o app depois de informar nome e especialidade.
export async function completarPerfil(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/app\/perfil/);
  await page.getByLabel('Nome completo').fill('Profissional E2E');
  await page.getByRole('combobox').selectOption('psicologia');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Perfil atualizado.')).toBeVisible();
}

// Conta nova pronta para usar: cadastrada, confirmada, logada e com o perfil completo.
export async function criarContaLogada(
  page: Page,
  request: APIRequestContext,
  prefixo: string,
): Promise<Conta> {
  const conta = contaNova(prefixo);
  await cadastrarEConfirmar(page, request, conta);
  await entrarComCodigo(page, request, conta);
  await completarPerfil(page);
  return conta;
}

// CPF válido (dígitos verificadores corretos) para o sandbox do Asaas; não é de uma pessoa real.
export const CPF_DE_TESTE = '529.982.247-25';

// PLANO-05: assina o Pro em "Meu plano" e espera o Pix aparecer.
export async function assinarPro(page: Page, conta: Conta): Promise<void> {
  await page.goto('/app/plano');
  await page.getByLabel('Nome completo').fill(conta.nome);
  await page.getByLabel('CPF ou CNPJ').fill(CPF_DE_TESTE);
  await page.getByRole('button', { name: 'Assinar', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Pagamento por Pix' })).toBeVisible({
    timeout: 45_000,
  });
}
