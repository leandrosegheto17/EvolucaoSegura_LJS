import type { Anamnese, ModeloAnamnese } from '@es/contrato/anamnese';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { AnamnesePage, ModeloAnamnesePage } from './anamnese.tsx';

// T97 / ANA-09 (e a tela das rotas ANA-01 a ANA-08): anamnese do paciente e editor do modelo.
// Casos de AnamnesisPage.spec, RectifyForm.spec e ModelEditor.spec do legado que valem com o
// contrato novo (uma especialidade, row_version no corpo, sem rascunho: ele vem em etapa
// posterior). Dado clínico: nenhuma mensagem de erro repete o texto digitado.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  definirCsrf(null);
  delete document.documentElement.dataset['theme'];
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const problema = (status: number, codigo: string) => json({ codigo, titulo: 'x', status }, status);

const MODELO: ModeloAnamnese = {
  especialidade: 'psicologia',
  revisao: 2,
  row_version: 7,
  bloqueado: false,
  campos: [
    { id: 'c1', rotulo: 'Queixa principal' },
    { id: 'c2', rotulo: 'Frequência', especial: 'frequencia' },
  ],
  alertas: [
    { id: 'a1', rotulo: 'Risco de autolesão' },
    { id: 'a2', rotulo: 'Uso de medicação' },
  ],
};

const ANAM: Anamnese = {
  id: 'an1',
  paciente_id: 'p1',
  data_sessao: '2026-10-20',
  modelo_revisao: 2,
  valores: { c1: 'Ansiedade no trabalho', a1: { marcado: true, obs: 'Relato antigo' } },
  estado: 'editavel_hoje',
  editavel_ate: '2026-10-21T02:59:59.999Z',
  row_version: 3,
  criado_em: '2026-10-20T12:00:00.000Z',
  versao_vigente: 0,
  retificacoes: [],
  alerta_clinico: true,
  alertas: [{ item_id: 'a1', rotulo: 'Risco de autolesão' }],
};
const REGISTRADA: Anamnese = { ...ANAM, estado: 'registrada' };

type Chamada = { metodo: string; url: string; corpo: unknown };
function mock(o: {
  modelo?: ModeloAnamnese;
  anamnese?: Anamnese | null;
  // Resposta das escritas: por "METODO url".
  escritas?: Record<string, () => Response>;
  falhaLeitura?: boolean;
}) {
  const chamadas: Chamada[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    chamadas.push({ metodo, url, corpo });
    if (url === '/api/eu') return json({ csrf_token: 'csrf' });
    if (o.falhaLeitura) return problema(500, 'erro');
    const escrita = o.escritas?.[`${metodo} ${url}`];
    if (escrita) return escrita();
    if (url === '/api/modelo-anamnese') return json(o.modelo ?? MODELO);
    if (url === '/api/pacientes/p1/anamnese') return json({ anamnese: o.anamnese ?? null });
    return problema(404, 'nao_encontrado');
  });
  vi.stubGlobal('fetch', f);
  return chamadas;
}
const escritas = (c: Chamada[]) => c.filter((x) => x.metodo !== 'GET' && x.url !== '/api/eu');

const cliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const setupAnamnese = () =>
  render(
    <QueryClientProvider client={cliente()}>
      <MemoryRouter initialEntries={['/app/pacientes/p1/anamnese']}>
        <Routes>
          <Route path="/app/pacientes/:id/anamnese" element={<AnamnesePage />} />
          <Route path="/app/modelo-anamnese" element={<p>tela do modelo</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
const setupModelo = () =>
  render(
    <QueryClientProvider client={cliente()}>
      <MemoryRouter initialEntries={['/app/modelo-anamnese']}>
        <Routes>
          <Route path="/app/modelo-anamnese" element={<ModeloAnamnesePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Anamnese do paciente: selos e alerta clínico (ANA-09)', () => {
  it('no dia do cadastro mostra o selo "Editável hoje", campos editáveis e salvar, sem retificar', async () => {
    mock({ anamnese: ANAM });
    setupAnamnese();
    expect(await screen.findByText('Editável hoje')).toBeTruthy();
    expect(screen.queryByText('Registrada')).toBeNull();
    const queixa = screen.getByLabelText('Queixa principal') as HTMLTextAreaElement;
    expect(queixa.value).toBe('Ansiedade no trabalho');
    expect(queixa.readOnly).toBe(false);
    expect(screen.getByRole('button', { name: 'Salvar anamnese' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retificar' })).toBeNull();
  });

  it('depois do dia mostra o selo "Registrada", conteúdo somente leitura e o botão Retificar', async () => {
    mock({ anamnese: REGISTRADA });
    setupAnamnese();
    expect(await screen.findByText('Registrada')).toBeTruthy();
    expect(screen.queryByText('Editável hoje')).toBeNull();
    expect((screen.getByLabelText('Queixa principal') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Salvar anamnese' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retificar' })).toBeTruthy();
  });

  it('destaca o alerta clínico com os rótulos marcados na versão vigente', async () => {
    const vigente: Anamnese = {
      ...REGISTRADA,
      versao_vigente: 1,
      retificacoes: [
        {
          seq: 1,
          motivo: 'Corrigir',
          modelo_revisao: 2,
          valores: { c1: 'Outro texto', a2: { marcado: true, obs: null } },
          criado_em: '2026-10-22T12:00:00.000Z',
        },
      ],
      alertas: [{ item_id: 'a2', rotulo: 'Uso de medicação' }],
    };
    mock({ anamnese: vigente });
    setupAnamnese();
    const selo = await screen.findByRole('button', { name: /Alerta clínico/ });
    await userEvent.click(selo);
    const lista = document.getElementById(selo.getAttribute('aria-controls') ?? '');
    expect(lista).toBeTruthy();
    expect(within(lista as HTMLElement).getByText('Uso de medicação')).toBeTruthy();
    expect(within(lista as HTMLElement).queryByText('Risco de autolesão')).toBeNull();
  });

  it('sem alerta marcado na versão vigente não mostra o selo de alerta clínico', async () => {
    mock({ anamnese: { ...ANAM, alerta_clinico: false, alertas: [] } });
    setupAnamnese();
    await screen.findByText('Editável hoje');
    expect(screen.queryByRole('button', { name: /Alerta clínico/ })).toBeNull();
  });

  it('paciente sem anamnese oferece registrar, com o POST por id de item e a revisão do modelo', async () => {
    const criada: Anamnese = { ...ANAM, valores: { c1: 'Insônia' } };
    const c = mock({
      anamnese: null,
      escritas: { 'POST /api/pacientes/p1/anamnese': () => json(criada, 201) },
    });
    setupAnamnese();
    expect(await screen.findByText('Anamnese ainda não registrada')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar anamnese' }));
    await userEvent.type(screen.getByLabelText('Queixa principal'), 'Insônia');
    await userEvent.selectOptions(screen.getByLabelText('Frequência'), 'quinzenal');
    await userEvent.click(screen.getByLabelText('Uso de medicação'));
    await userEvent.type(screen.getByLabelText('Observação: Uso de medicação'), 'Sertralina');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar anamnese' }));
    expect(await screen.findByText('Editável hoje')).toBeTruthy();
    const [post] = escritas(c);
    expect(post?.url).toBe('/api/pacientes/p1/anamnese');
    expect(post?.corpo).toMatchObject({
      modelo_revisao: 2,
      valores: { c1: 'Insônia', c2: 'quinzenal', a2: { marcado: true, obs: 'Sertralina' } },
    });
    expect((post?.corpo as { data_sessao: string }).data_sessao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('ANAMNESIS_EXISTS e ANAMNESIS_VALUE_INVALID mostram mensagem fixa, sem repetir o texto digitado', async () => {
    mock({
      anamnese: null,
      escritas: { 'POST /api/pacientes/p1/anamnese': () => problema(409, 'ANAMNESIS_EXISTS') },
    });
    setupAnamnese();
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar anamnese' }));
    await userEvent.type(screen.getByLabelText('Queixa principal'), 'segredo clínico');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar anamnese' }));
    const aviso = await screen.findByRole('alert');
    expect(aviso.textContent).toMatch(/O paciente já tem anamnese/);
    expect(aviso.textContent).not.toContain('segredo clínico');
    cleanup();

    mock({
      anamnese: null,
      escritas: {
        'POST /api/pacientes/p1/anamnese': () => problema(422, 'ANAMNESIS_VALUE_INVALID'),
      },
    });
    setupAnamnese();
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar anamnese' }));
    await userEvent.type(screen.getByLabelText('Queixa principal'), 'segredo clínico');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar anamnese' }));
    const invalido = await screen.findByRole('alert');
    expect(invalido.textContent).toMatch(/Há valor inválido na anamnese/);
    expect(invalido.textContent).not.toContain('segredo clínico');
  });

  it('editar no dia envia PUT com row_version e os valores completos (ANA-05)', async () => {
    const c = mock({
      anamnese: ANAM,
      escritas: { 'PUT /api/anamneses/an1': () => json({ ...ANAM, row_version: 4 }) },
    });
    setupAnamnese();
    const queixa = await screen.findByLabelText('Queixa principal');
    await userEvent.clear(queixa);
    await userEvent.type(queixa, 'Novo relato');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar anamnese' }));
    expect(await screen.findByText('Anamnese salva.')).toBeTruthy();
    const [put] = escritas(c);
    expect(put?.corpo).toEqual({
      modelo_revisao: 2,
      row_version: 3,
      valores: { c1: 'Novo relato', a1: { marcado: true, obs: 'Relato antigo' } },
    });
  });

  it('EDIT_WINDOW_CLOSED e versao_divergente na edição orientam sem repetir conteúdo', async () => {
    mock({
      anamnese: ANAM,
      escritas: { 'PUT /api/anamneses/an1': () => problema(409, 'EDIT_WINDOW_CLOSED') },
    });
    setupAnamnese();
    await userEvent.click(await screen.findByRole('button', { name: 'Salvar anamnese' }));
    expect(await screen.findByText(/O prazo de edição acabou: use a retificação/)).toBeTruthy();
    cleanup();

    mock({
      anamnese: ANAM,
      escritas: { 'PUT /api/anamneses/an1': () => problema(409, 'versao_divergente') },
    });
    setupAnamnese();
    await userEvent.click(await screen.findByRole('button', { name: 'Salvar anamnese' }));
    expect(await screen.findByText(/foi alterada em outro lugar/)).toBeTruthy();
  });

  it('erro ao carregar oferece tentar novamente', async () => {
    mock({ falhaLeitura: true });
    setupAnamnese();
    expect(await screen.findByText('Não foi possível carregar a anamnese.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it('oferece o caminho para o editor do modelo', async () => {
    mock({ anamnese: ANAM });
    setupAnamnese();
    const link = await screen.findByRole('link', { name: 'Editar modelo da anamnese' });
    expect(link.getAttribute('href')).toBe('/app/modelo-anamnese');
  });

  it('sem violações de acessibilidade nos dois temas', async () => {
    mock({ anamnese: REGISTRADA });
    const { container } = setupAnamnese();
    await screen.findByText('Registrada');
    expect((await axe(container)).violations).toEqual([]);
    document.documentElement.dataset['theme'] = 'dark';
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Retificação (ANA-06, ANA-07, ANA-08)', () => {
  const abrir = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Retificar' }));
    return screen.getByRole('form', { name: 'Retificar anamnese' });
  };

  it('sem motivo não envia e pede o motivo', async () => {
    const c = mock({ anamnese: REGISTRADA });
    setupAnamnese();
    const form = await abrir();
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar retificação' }));
    expect(await within(form).findByText('Informe o motivo da retificação.')).toBeTruthy();
    expect(escritas(c)).toEqual([]);
  });

  it('envia motivo aparado, valores novos e revisão; a nova versão vira a vigente e a original fica listada', async () => {
    const nova: Anamnese = {
      ...REGISTRADA,
      versao_vigente: 1,
      retificacoes: [
        {
          seq: 1,
          motivo: 'Erro de digitação',
          modelo_revisao: 2,
          valores: { c1: 'Texto corrigido' },
          criado_em: '2026-10-22T15:00:00.000Z',
        },
      ],
      alertas: [],
      alerta_clinico: false,
    };
    const c = mock({
      anamnese: REGISTRADA,
      escritas: { 'POST /api/anamneses/an1/retificacoes': () => json(nova, 201) },
    });
    setupAnamnese();
    const form = await abrir();
    // parte da versão vigente: o campo já traz o texto da original
    const queixa = within(form).getByLabelText('Queixa principal') as HTMLTextAreaElement;
    expect(queixa.value).toBe('Ansiedade no trabalho');
    await userEvent.clear(queixa);
    await userEvent.type(queixa, 'Texto corrigido');
    await userEvent.click(within(form).getByLabelText('Risco de autolesão'));
    await userEvent.type(
      within(form).getByLabelText(/^Motivo da retificação/),
      '  Erro de digitação  ',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar retificação' }));
    const versoes = await screen.findByRole('region', { name: 'Versões da anamnese' });
    expect(within(versoes).getByRole('article', { name: 'Versão original' })).toBeTruthy();
    const ret = within(versoes).getByRole('article', { name: 'Retificação 1' });
    expect(within(ret).getByText(/\(vigente\)/)).toBeTruthy();
    expect(within(ret).getByText('Erro de digitação')).toBeTruthy();
    expect(within(ret).getByText('Texto corrigido')).toBeTruthy();
    expect(within(versoes).getByText('Ansiedade no trabalho')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Retificar anamnese' })).toBeNull();
    const [post] = escritas(c);
    expect(post?.corpo).toEqual({
      modelo_revisao: 2,
      motivo: 'Erro de digitação',
      valores: { c1: 'Texto corrigido' },
    });
  });

  it.each([
    ['EDIT_WINDOW_OPEN', 409, /ainda pode ser editada hoje/],
    ['sem_conteudo_novo', 400, /precisa alterar o conteúdo/],
    ['RECTIFICATION_CONFLICT', 409, /Outra retificação foi salva antes/],
    ['ANAMNESIS_VALUE_INVALID', 422, /modelo da anamnese mudou ou há valor inválido/],
  ])('%s mostra mensagem fixa e mantém o texto digitado', async (codigo, status, msg) => {
    mock({
      anamnese: REGISTRADA,
      escritas: { 'POST /api/anamneses/an1/retificacoes': () => problema(status, codigo) },
    });
    setupAnamnese();
    const form = await abrir();
    await userEvent.type(within(form).getByLabelText(/^Motivo da retificação/), 'meu motivo');
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar retificação' }));
    expect(await within(form).findByText(msg)).toBeTruthy();
    expect(
      (within(form).getByLabelText(/^Motivo da retificação/) as HTMLTextAreaElement).value,
    ).toBe('meu motivo');
  });

  it('cancelar fecha o formulário sem enviar', async () => {
    const c = mock({ anamnese: REGISTRADA });
    setupAnamnese();
    const form = await abrir();
    await userEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: 'Retificar anamnese' })).toBeNull();
    expect(escritas(c)).toEqual([]);
  });
});

describe('Editor do modelo (ANA-01, ANA-02, ANA-03)', () => {
  it('lista campos e alertas na ordem do modelo, com os contadores de limite', async () => {
    mock({});
    setupModelo();
    expect(await screen.findByDisplayValue('Queixa principal')).toBeTruthy();
    expect((screen.getByLabelText('Nome do campo 1') as HTMLInputElement).value).toBe(
      'Queixa principal',
    );
    expect((screen.getByLabelText('Nome do campo 2') as HTMLInputElement).value).toBe('Frequência');
    expect((screen.getByLabelText('Nome do alerta 2') as HTMLInputElement).value).toBe(
      'Uso de medicação',
    );
    expect(screen.getByText('2 de 30 campos')).toBeTruthy();
    expect(screen.getByText('2 de 12 alertas')).toBeTruthy();
  });

  it('inclui item novo, renomeia, reordena e salva com row_version; existentes vão com id e o novo sem', async () => {
    const c = mock({
      escritas: {
        'PUT /api/modelo-anamnese': () => json({ ...MODELO, revisao: 3, row_version: 8 }),
      },
    });
    setupModelo();
    await screen.findByDisplayValue('Queixa principal');
    await userEvent.type(screen.getByLabelText('Novo campo'), '  Histórico familiar ');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar campo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Subir campo 3' }));
    const nome = screen.getByLabelText('Nome do alerta 1');
    await userEvent.clear(nome);
    await userEvent.type(nome, 'Autolesão');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }));
    expect(await screen.findByText('Modelo salvo.')).toBeTruthy();
    const [put] = escritas(c);
    expect(put?.url).toBe('/api/modelo-anamnese');
    expect(put?.corpo).toEqual({
      row_version: 7,
      campos: [
        { id: 'c1', rotulo: 'Queixa principal' },
        { rotulo: 'Histórico familiar' },
        { id: 'c2', rotulo: 'Frequência', especial: 'frequencia' },
      ],
      alertas: [
        { id: 'a1', rotulo: 'Autolesão' },
        { id: 'a2', rotulo: 'Uso de medicação' },
      ],
    });
  });

  it('remove um item quando o modelo não está bloqueado', async () => {
    const c = mock({ escritas: { 'PUT /api/modelo-anamnese': () => json(MODELO) } });
    setupModelo();
    await screen.findByDisplayValue('Queixa principal');
    await userEvent.click(screen.getByRole('button', { name: 'Remover alerta 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }));
    await screen.findByText('Modelo salvo.');
    expect((escritas(c)[0]?.corpo as { alertas: unknown[] }).alertas).toEqual([
      { id: 'a1', rotulo: 'Risco de autolesão' },
    ]);
  });

  it('modelo bloqueado: itens existentes ficam travados (sem editar, mover ou remover) e só se inclui', async () => {
    mock({ modelo: { ...MODELO, bloqueado: true } });
    setupModelo();
    expect(await screen.findByText(/Modelo bloqueado/)).toBeTruthy();
    expect(screen.queryByLabelText('Nome do campo 1')).toBeNull();
    expect(screen.getByText('Queixa principal')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Remover/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Subir/ })).toBeNull();
    await userEvent.type(screen.getByLabelText('Novo alerta'), 'Gestante');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar alerta' }));
    expect((screen.getByLabelText('Nome do alerta 3') as HTMLInputElement).value).toBe('Gestante');
  });

  it('rótulo vazio ou repetido (sem diferenciar maiúsculas) é recusado antes de enviar', async () => {
    const c = mock({});
    setupModelo();
    await screen.findByDisplayValue('Queixa principal');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar campo' }));
    expect(await screen.findByText('Informe um nome.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Novo campo'), 'QUEIXA PRINCIPAL');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar campo' }));
    expect(await screen.findByText('Já existe um item com este nome.')).toBeTruthy();
    expect(screen.getByText('2 de 30 campos')).toBeTruthy();
    expect(escritas(c)).toEqual([]);
  });

  it('com 30 campos o limite impede incluir mais', async () => {
    const campos = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, rotulo: `Campo ${i}` }));
    mock({ modelo: { ...MODELO, campos } });
    setupModelo();
    await screen.findByText('30 de 30 campos');
    expect(
      (screen.getByRole('button', { name: 'Adicionar campo' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each([
    ['MODEL_LOCKED', 409, /campos e alertas existentes não podem ser removidos nem renomeados/],
    ['MODEL_LABEL_INVALID', 422, /Rótulo inválido/],
    ['versao_divergente', 409, /foi alterado em outro lugar/],
  ])('%s mostra mensagem fixa', async (codigo, status, msg) => {
    mock({ escritas: { 'PUT /api/modelo-anamnese': () => problema(status, codigo) } });
    setupModelo();
    await screen.findByDisplayValue('Queixa principal');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }));
    expect(await screen.findByText(msg)).toBeTruthy();
  });

  it('sem violações de acessibilidade', async () => {
    mock({});
    const { container } = setupModelo();
    await screen.findByDisplayValue('Queixa principal');
    expect((await axe(container)).violations).toEqual([]);
  });
});
