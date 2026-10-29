import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// OPS-05: passos do fluxo clínico (paciente, sessão, evolução) pela interface.

// Dia útil mais recente (hoje, se for dia útil) em America/Sao_Paulo, como AAAA-MM-DD: o perfil
// novo não atende sábado nem domingo (AGE-06).
export function diaUtilRecente(agora: Date = new Date()): string {
  const dia = new Date(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)}T12:00:00Z`,
  );
  while (dia.getUTCDay() === 0 || dia.getUTCDay() === 6) dia.setUTCDate(dia.getUTCDate() - 1);
  return dia.toISOString().slice(0, 10);
}

// PAC-01: cadastra o paciente e devolve o id (a ficha abre em /app/pacientes/<id>).
export async function criarPaciente(page: Page, nome: string): Promise<string> {
  await page.goto('/app/pacientes/novo');
  await page.getByRole('textbox', { name: /^Nome/ }).fill(nome);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/app\/pacientes\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop()!;
}

// AGE-01: agenda a sessão do paciente no dia e na hora, e a vê agendada na agenda.
export async function agendarSessao(
  page: Page,
  nomePaciente: string,
  data: string,
  hora: string,
): Promise<void> {
  await page.goto('/app/agenda/nova');
  await page.getByLabel('Paciente').selectOption({ label: nomePaciente });
  await page.getByLabel('Data').fill(data);
  await page.getByLabel('Hora').fill(hora);
  await page.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/agenda\?semana=/);
  await expect(page.getByText(nomePaciente)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: nomePaciente })).toContainText(
    'Agendada',
  );
}

// Id da sessão do paciente, lido da API (a tela da agenda não o mostra); serve para conferir o
// ?sessao= que o link da agenda gera.
export async function idDaSessao(page: Page, pacienteId: string, data: string): Promise<string> {
  const de = new Date(`${data}T00:00:00Z`);
  de.setUTCDate(de.getUTCDate() - 1);
  const ate = new Date(de);
  ate.setUTCDate(ate.getUTCDate() + 3);
  const resposta = await page.request.get('/api/sessoes', {
    params: { de: de.toISOString(), ate: ate.toISOString(), limit: '100' },
  });
  expect(resposta.ok()).toBe(true);
  const pagina = (await resposta.json()) as { items: { id: string; paciente_id: string }[] };
  const sessao = pagina.items.find((s) => s.paciente_id === pacienteId);
  if (!sessao) throw new Error('sessão do paciente não encontrada');
  return sessao.id;
}

// EVO-01, EVO-03: registra a evolução ligada à sessão pelos cliques, como a pessoa faz: abre a
// agenda da semana da sessão, clica em "Evolução" na linha do paciente e confere que a tela da
// evolução recebeu a sessão em ?sessao=<id> (T206; antes o e2e navegava direto para a URL com
// ?sessao=, o que escondia a falta do link na interface).
export async function registrarEvolucao(
  page: Page,
  nomePaciente: string,
  data: string,
  pacienteId: string,
  sessaoId: string,
): Promise<void> {
  await page.goto(`/app/agenda?semana=${data}`);
  await page
    .getByRole('listitem')
    .filter({ hasText: nomePaciente })
    .getByRole('link', { name: 'Evolução' })
    .click();
  await expect(page).toHaveURL(`/app/pacientes/${pacienteId}/evolucao?sessao=${sessaoId}`);
  await page
    .getByLabel('Texto da evolução')
    .fill('Paciente colaborativo; relatou melhora do sono.');
  await page.getByRole('button', { name: 'Registrar evolução' }).click();
  await expect(page.getByText('Evolução registrada.')).toBeVisible();
}

// FIN-09: valor padrão da sessão do paciente, em reais (ex.: '150,00').
export async function definirPrecoDoPaciente(
  page: Page,
  pacienteId: string,
  valor: string,
): Promise<void> {
  await page.goto(`/app/financeiro/preco/paciente/${pacienteId}`);
  await page.getByLabel('Valor padrão da sessão').fill(valor);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText(/Valor atual: R\$\s*150,00/)).toBeVisible();
}
