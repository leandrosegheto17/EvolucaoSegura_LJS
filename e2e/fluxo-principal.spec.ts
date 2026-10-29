import { expect, test } from '@playwright/test';
import { criarContaLogada } from './apoio/conta.ts';
import {
  agendarSessao,
  criarPaciente,
  diaUtilRecente,
  idDaSessao,
  registrarEvolucao,
} from './apoio/clinico.ts';

// AGE-01, EVO-03: cria a sessão na agenda, registra a evolução e a sessão vira realizada.

test('sessão criada e evolução registrada: a sessão vira realizada', async ({ page, request }) => {
  await criarContaLogada(page, request, 'principal');
  const nome = 'Paciente Fluxo E2E';
  const data = diaUtilRecente();

  const pacienteId = await criarPaciente(page, nome);
  await agendarSessao(page, nome, data, '10:00');
  const sessaoId = await idDaSessao(page, pacienteId, data);

  const sessao = page.getByRole('listitem').filter({ hasText: nome });
  await expect(sessao).not.toContainText('Realizada');

  await registrarEvolucao(page, nome, data, pacienteId, sessaoId);

  await page.goto(`/app/agenda?semana=${data}`);
  await expect(sessao).toContainText('Realizada');
});
