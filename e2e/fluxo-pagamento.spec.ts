import { expect, test } from '@playwright/test';
import { criarContaLogada } from './apoio/conta.ts';
import {
  agendarSessao,
  criarPaciente,
  definirPrecoDoPaciente,
  diaUtilRecente,
  idDaSessao,
  registrarEvolucao,
} from './apoio/clinico.ts';

// FIN-03: registrar o pagamento de uma sessão realizada e ver o débito sumir do financeiro.

test('pagamento registrado: o débito do paciente some', async ({ page, request }) => {
  await criarContaLogada(page, request, 'pagamento');
  const nome = 'Paciente Débito E2E';
  const data = diaUtilRecente();

  const pacienteId = await criarPaciente(page, nome);
  await definirPrecoDoPaciente(page, pacienteId, '150,00');
  await agendarSessao(page, nome, data, '14:00');
  const sessaoId = await idDaSessao(page, pacienteId, data);
  await registrarEvolucao(page, pacienteId, sessaoId);

  // A sessão realizada e cobrável aparece como débito.
  await page.goto('/app/financeiro');
  const linha = page.getByRole('row').filter({ hasText: nome });
  await expect(linha).toContainText('Em débito');
  await expect(page.getByTestId('total-pendente')).toContainText('150,00');

  // Registra o pagamento da sessão pendente.
  await linha.getByRole('button', { name: /^Ver pendências/ }).click();
  await page.getByRole('link', { name: /^Registrar pagamento da sessão/ }).click();
  await page.getByLabel('Meio de pagamento').selectOption('pix');
  await page.getByRole('button', { name: 'Marcar como pago' }).click();
  await expect(page.getByText('Sessão marcada como paga')).toBeVisible();

  // O débito some.
  await page.goto('/app/financeiro');
  const depois = page.getByRole('row').filter({ hasText: nome });
  await expect(depois).toContainText('Em dia');
  await expect(depois).not.toContainText('Em débito');
  await expect(page.getByTestId('total-pendente')).toContainText('0,00');
});
