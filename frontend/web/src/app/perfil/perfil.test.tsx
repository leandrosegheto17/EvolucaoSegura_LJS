import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { ProfilePage } from './perfil.tsx';

// T66 / PERF-01, PERF-02, PERF-03: tela "Meu perfil profissional". Casos de
// features/profile/ProfilePage.spec.tsx do legado (carga, primeiro preenchimento, erro, nome vazio,
// salvar, dias de atendimento, a11y), sem o histórico (fora da spec), mais:
// - campos e limites do contrato (nome 200, contato 200, endereço 300; especialidade única com
//   nome de 1 a 60 para "outra", conselho 40, número 40, região 100);
// - a troca de especialidade mostra o erro do servidor (409 SPECIALTY_HAS_ANAMNESIS, PERF-05).

afterEach(() => {
  vi.unstubAllGlobals();
  definirCsrf(null);
});

const P = {
  nome: 'Dra. Exemplo',
  contato: null,
  endereco: null,
  atende_sabado: false,
  atende_domingo: false,
  especialidade: {
    tipo: 'psicologia',
    nome: null,
    conselho: 'CRP',
    numero_registro: '06/1',
    regiao: 'SP',
  },
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function stub(routes: Record<string, () => Response>) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const h = routes[key];
    if (!h) throw new Error(`sem mock: ${key}`);
    return h();
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const base = { 'GET /api/eu': () => json({ perfil: { completo: true }, csrf_token: 't' }) };

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

const corpoDoPut = (f: ReturnType<typeof stub>) =>
  JSON.parse(String(f.mock.calls.find((c) => c[1]?.method === 'PUT')![1]!.body)) as Record<
    string,
    unknown
  >;
const salvar = () => userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

describe('Perfil (legado)', () => {
  it('mostra carregando e depois o formulário; sem preferências nem histórico', async () => {
    stub({ ...base, 'GET /api/perfil': () => json(P) });
    const { container } = setup();
    expect(screen.getByText('Carregando perfil')).toBeTruthy();
    // T222: espera o valor (o campo aparece antes de ser preenchido; falhava sob carga). Alterado
    // com aprovação do usuário em 2026-10-30.
    const nome = await screen.findByLabelText(/Nome completo/);
    await waitFor(() => expect(nome).toHaveProperty('value', 'Dra. Exemplo'));
    expect(container.textContent).not.toMatch(/Preferências|IA para pré-texto|inatividade/i);
    expect(container.textContent).not.toMatch(/histórico/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Meu perfil profissional');
  });

  it('primeiro preenchimento (404) avisa para completar', async () => {
    stub({ ...base, 'GET /api/perfil': () => json({ codigo: 'nao_encontrado' }, 404) });
    setup();
    expect(await screen.findByText(/Complete seu perfil/)).toBeTruthy();
    expect(screen.getByLabelText(/Nome completo/)).toHaveProperty('value', '');
  });

  it('perfil sem especialidade também avisa para completar (PERF-01)', async () => {
    stub({ ...base, 'GET /api/perfil': () => json({ ...P, especialidade: null }) });
    setup();
    expect(await screen.findByText(/Complete seu perfil/)).toBeTruthy();
  });

  it('perfil completo não mostra o aviso', async () => {
    stub({ ...base, 'GET /api/perfil': () => json(P) });
    setup();
    await screen.findByLabelText(/Nome completo/);
    expect(screen.queryByText(/Complete seu perfil/)).toBeNull();
  });

  it('erro de carga oferece nova tentativa', async () => {
    stub({ ...base, 'GET /api/perfil': () => json({}, 500) });
    setup();
    expect(await screen.findByText(/Não foi possível carregar/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it('nome vazio: erro de validação no campo, sem PUT', async () => {
    const f = stub({ ...base, 'GET /api/perfil': () => json({ ...P, nome: '' }) });
    setup();
    await screen.findByLabelText(/Nome completo/);
    await salvar();
    expect(await screen.findByText('Informe o nome completo.')).toBeTruthy();
    expect(f.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false);
  });

  it('salvar envia PUT com perfil e especialidade e mostra a confirmação', async () => {
    const f = stub({
      ...base,
      'GET /api/perfil': () => json(P),
      'PUT /api/perfil': () => json({ ...P, endereco: 'Rua X' }),
    });
    setup();
    await userEvent.type(await screen.findByLabelText(/Endereço/), 'Rua X');
    await salvar();
    expect(await screen.findByText('Perfil atualizado.')).toBeTruthy();
    expect(corpoDoPut(f)).toEqual({
      nome: 'Dra. Exemplo',
      contato: null,
      endereco: 'Rua X',
      atende_sabado: false,
      atende_domingo: false,
      especialidade: P.especialidade,
    });
  });

  it('salvar atualiza o estado do perfil da guarda (GET /api/eu de novo)', async () => {
    const f = stub({
      ...base,
      'GET /api/perfil': () => json({ codigo: 'nao_encontrado' }, 404),
      'PUT /api/perfil': () => json(P),
    });
    const { qc } = setup();
    qc.setQueryData(['eu'], { perfil: { completo: false } });
    await userEvent.type(await screen.findByLabelText(/Nome completo/), 'Dra. Exemplo');
    await userEvent.selectOptions(screen.getByLabelText(/^Especialidade/), 'psicologia');
    await salvar();
    await screen.findByText('Perfil atualizado.');
    await vi.waitFor(() => expect(f.mock.calls.map((c) => c[0])).toContain('/api/eu'));
    expect(screen.queryByText(/Complete seu perfil/)).toBeNull();
  });

  it('dias de atendimento: independentes, padrão desligados, salvos com o formulário', async () => {
    const f = stub({
      ...base,
      'GET /api/perfil': () => json(P),
      'PUT /api/perfil': () => json({ ...P, atende_sabado: true }),
    });
    setup();
    const sab = await screen.findByRole('switch', { name: /Atendo aos sábados/ });
    const dom = screen.getByRole('switch', { name: /Atendo aos domingos/ });
    expect((sab as HTMLInputElement).checked).toBe(false);
    expect((dom as HTMLInputElement).checked).toBe(false);
    await userEvent.click(sab);
    expect((dom as HTMLInputElement).checked).toBe(false);
    await salvar();
    await screen.findByText('Perfil atualizado.');
    expect(corpoDoPut(f)).toMatchObject({ atende_sabado: true, atende_domingo: false });
  });

  it('carrega flags salvas (persistência)', async () => {
    stub({ ...base, 'GET /api/perfil': () => json({ ...P, atende_domingo: true }) });
    setup();
    expect(
      ((await screen.findByRole('switch', { name: /domingos/ })) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('falha ao salvar mostra erro', async () => {
    stub({ ...base, 'GET /api/perfil': () => json(P), 'PUT /api/perfil': () => json({}, 500) });
    setup();
    await screen.findByLabelText(/Nome completo/);
    await salvar();
    expect(await screen.findByText(/Não foi possível salvar/)).toBeTruthy();
  });

  it('cancelar volta ao que está salvo', async () => {
    stub({ ...base, 'GET /api/perfil': () => json(P) });
    setup();
    const nome = await screen.findByLabelText(/Nome completo/);
    await userEvent.clear(nome);
    await userEvent.type(nome, 'Outro nome');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(nome).toHaveProperty('value', 'Dra. Exemplo');
  });

  it('sem violações de a11y', async () => {
    stub({ ...base, 'GET /api/perfil': () => json(P) });
    const { container } = setup();
    await screen.findByLabelText(/Nome completo/);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('campos e limites do contrato (PERF-02, PERF-03)', () => {
  it('nome, contato e endereço com os limites 200, 200 e 300; nome obrigatório', async () => {
    stub({ ...base, 'GET /api/perfil': () => json(P) });
    setup();
    const nome = await screen.findByLabelText(/Nome completo/);
    expect(nome).toHaveAttribute('maxlength', '200');
    expect(nome).toHaveAttribute('required');
    expect(screen.getByLabelText(/Contato/)).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText(/Endereço/)).toHaveAttribute('maxlength', '300');
  });

  it('uma especialidade só: um seletor com os quatro tipos da spec e o registro opcional', async () => {
    stub({ ...base, 'GET /api/perfil': () => json(P) });
    setup();
    const seletor = await screen.findByLabelText(/^Especialidade/);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(
      within(seletor)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Selecione', 'Psicologia', 'Nutrição', 'Fisioterapia', 'Outra']);
    expect(seletor).toHaveProperty('value', 'psicologia');
    expect(screen.getByLabelText('Conselho')).toHaveAttribute('maxlength', '40');
    expect(screen.getByLabelText('Conselho')).not.toHaveAttribute('required');
    expect(screen.getByLabelText('Número do registro')).toHaveAttribute('maxlength', '40');
    expect(screen.getByLabelText('Região')).toHaveAttribute('maxlength', '100');
    expect(screen.queryByLabelText(/Nome da especialidade/)).toBeNull();
  });

  it('sem especialidade escolhida: erro no campo, sem PUT', async () => {
    const f = stub({ ...base, 'GET /api/perfil': () => json({ ...P, especialidade: null }) });
    setup();
    await screen.findByLabelText(/Nome completo/);
    await salvar();
    expect(await screen.findByText('Escolha a especialidade.')).toBeTruthy();
    expect(f.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false);
  });

  it('outra pede o nome da especialidade (1 a 60) antes de enviar', async () => {
    const f = stub({
      ...base,
      'GET /api/perfil': () => json(P),
      'PUT /api/perfil': () =>
        json({
          ...P,
          especialidade: {
            tipo: 'outra',
            nome: 'Arteterapia',
            conselho: null,
            numero_registro: null,
            regiao: null,
          },
        }),
    });
    setup();
    await userEvent.selectOptions(await screen.findByLabelText(/^Especialidade/), 'outra');
    const nomeEsp = screen.getByLabelText(/Nome da especialidade/);
    expect(nomeEsp).toHaveAttribute('maxlength', '60');
    expect(nomeEsp).toHaveAttribute('required');

    await salvar();
    expect(
      await screen.findByText('Informe o nome da especialidade (1 a 60 caracteres).'),
    ).toBeTruthy();
    expect(f.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false);

    await userEvent.type(nomeEsp, 'Arteterapia');
    await salvar();
    await screen.findByText('Perfil atualizado.');
    expect(corpoDoPut(f)['especialidade']).toEqual({
      tipo: 'outra',
      nome: 'Arteterapia',
      conselho: 'CRP',
      numero_registro: '06/1',
      regiao: 'SP',
    });
  });

  it('vazio vai como null no registro profissional', async () => {
    const f = stub({ ...base, 'GET /api/perfil': () => json(P), 'PUT /api/perfil': () => json(P) });
    setup();
    await userEvent.clear(await screen.findByLabelText('Conselho'));
    await salvar();
    await screen.findByText('Perfil atualizado.');
    expect(corpoDoPut(f)['especialidade']).toMatchObject({ conselho: null });
  });
});

describe('troca de especialidade mostra o erro do servidor (PERF-05)', () => {
  it('409 SPECIALTY_HAS_ANAMNESIS: aviso de que a especialidade tem anamnese', async () => {
    stub({
      ...base,
      'GET /api/perfil': () => json(P),
      'PUT /api/perfil': () =>
        json(
          {
            tipo: 'about:blank',
            titulo: 'Especialidade com anamnese',
            status: 409,
            codigo: 'SPECIALTY_HAS_ANAMNESIS',
          },
          409,
        ),
    });
    setup();
    await userEvent.selectOptions(await screen.findByLabelText(/^Especialidade/), 'nutricao');
    await salvar();
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Esta especialidade já tem anamnese registrada e não pode ser trocada\./,
    );
    expect(screen.queryByText('Perfil atualizado.')).toBeNull();
  });

  it('outro 409 mostra o título que o servidor mandou', async () => {
    stub({
      ...base,
      'GET /api/perfil': () => json(P),
      'PUT /api/perfil': () =>
        json(
          { tipo: 'about:blank', titulo: 'Conflito no perfil', status: 409, codigo: 'conflito' },
          409,
        ),
    });
    setup();
    await userEvent.selectOptions(await screen.findByLabelText(/^Especialidade/), 'nutricao');
    await salvar();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Conflito no perfil/);
  });

  it('422 do servidor pede para conferir os campos', async () => {
    stub({
      ...base,
      'GET /api/perfil': () => json(P),
      'PUT /api/perfil': () =>
        json({ tipo: 'about:blank', titulo: 'x', status: 422, codigo: 'validacao' }, 422),
    });
    setup();
    await screen.findByLabelText(/Nome completo/);
    await salvar();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Confira os campos/);
  });
});
