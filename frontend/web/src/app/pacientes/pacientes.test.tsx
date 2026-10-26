import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { PatientFormPage } from './novo.tsx';
import { PatientsListPage } from './pacientes.tsx';
import { PatientStatusPage } from './situacao.tsx';

// T73 / PAC-01, PAC-02, PAC-03, PAC-07: telas de lista, situação e novo paciente. Casos de
// patients/list/PatientsListPage.spec.tsx, patients/status/PatientStatusPage.spec.tsx e
// features/patients/form/PatientFormPage.spec.tsx do legado, para /api/pacientes e rotas sob
// /app: busca por nome e filtro de ativos (padrão ativos; inativos e todos), inativação e
// reativação com os textos do legado, nenhuma ação de excluir, e o cadastro só com o nome.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  definirCsrf(null);
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const cliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const P = {
  telefone: null,
  email: null,
  endereco: null,
  row_version: 1,
  criado_em: '2026-10-01T12:00:00.000Z',
};
const ana = { ...P, id: 'p1', nome: 'Ana Souza', telefone: '1199', ativo: true };
const bia = { ...P, id: 'p2', nome: 'Bia Lima', email: 'b@x.com', ativo: false };

describe('Lista de pacientes (PAC-02)', () => {
  const mockLista = (items: unknown[] | 'erro') => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      items === 'erro'
        ? json({ codigo: 'erro_interno' }, 500)
        : json({ items, limit: 100, offset: 0 }),
    );
    vi.stubGlobal('fetch', f);
    return f;
  };
  const urlDe = (f: ReturnType<typeof vi.fn>) => String(f.mock.calls.at(-1)![0]);

  function Onde() {
    const l = useLocation();
    const t = useNavigationType();
    return (
      <output data-testid="loc" data-nav={t}>
        {l.pathname + l.search}
      </output>
    );
  }
  const setup = (url = '/app/pacientes') =>
    render(
      <QueryClientProvider client={cliente()}>
        <MemoryRouter initialEntries={[url]}>
          <PatientsListPage />
          <Onde />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('lista ativos por padrão, com limit 100, e liga o nome à ficha', async () => {
    const f = mockLista([ana]);
    setup();
    const link = await screen.findByRole('link', { name: 'Ana Souza' });
    expect(link.getAttribute('href')).toBe('/app/pacientes/p1');
    expect(urlDe(f)).toBe('/api/pacientes?ativo=true&limit=100');
    expect(screen.getByText('1199')).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
  });

  it('"Novo paciente" leva a /app/pacientes/novo', async () => {
    mockLista([ana]);
    setup();
    await screen.findByRole('link', { name: 'Ana Souza' });
    expect(screen.getByRole('link', { name: 'Novo paciente' }).getAttribute('href')).toBe(
      '/app/pacientes/novo',
    );
  });

  it('vazio sem filtro convida a cadastrar', async () => {
    mockLista([]);
    setup();
    expect(await screen.findByText('Você ainda não tem pacientes')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Cadastrar o primeiro paciente' }).getAttribute('href'),
    ).toBe('/app/pacientes/novo');
  });

  it('busca sem resultado', async () => {
    mockLista([]);
    setup('/app/pacientes?q=zzz');
    expect(await screen.findByText('Nenhum paciente encontrado')).toBeTruthy();
  });

  it('erro ao carregar com nova tentativa', async () => {
    const f = mockLista('erro');
    setup();
    expect(await screen.findByText('Não foi possível carregar os pacientes.')).toBeTruthy();
    f.mockImplementation(async () => json({ items: [ana], limit: 100, offset: 0 }));
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: 'Ana Souza' })).toBeTruthy();
  });

  it('busca e filtro de inativos vão para a URL e para a API', async () => {
    const f = mockLista([ana]);
    setup();
    await screen.findByRole('link', { name: 'Ana Souza' });
    fireEvent.change(screen.getByLabelText('Buscar por nome'), { target: { value: ' ana ' } });
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByTestId('loc').textContent).toBe('/app/pacientes?q=ana');
    await vi.waitFor(() => expect(urlDe(f)).toBe('/api/pacientes?q=ana&ativo=true&limit=100'));
    await userEvent.selectOptions(screen.getByLabelText('Situação'), 'inativos');
    expect(screen.getByTestId('loc').textContent).toBe('/app/pacientes?q=ana&filtro=inativos');
    await vi.waitFor(() => expect(urlDe(f)).toBe('/api/pacientes?q=ana&ativo=false&limit=100'));
  });

  it('busca e filtro usam replace (sem acumular ?q= no histórico)', async () => {
    mockLista([ana]);
    setup();
    await screen.findByRole('link', { name: 'Ana Souza' });
    fireEvent.change(screen.getByLabelText('Buscar por nome'), { target: { value: 'ana' } });
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByTestId('loc').getAttribute('data-nav')).toBe('REPLACE');
    await userEvent.selectOptions(screen.getByLabelText('Situação'), 'inativos');
    expect(screen.getByTestId('loc').getAttribute('data-nav')).toBe('REPLACE');
  });

  it('"Todos" não manda ativo; restaura busca e filtro a partir da URL', async () => {
    const f = mockLista([bia]);
    setup('/app/pacientes?q=bia&filtro=todos');
    expect(await screen.findByText('Inativo')).toBeTruthy();
    expect(screen.getByText('b@x.com')).toBeTruthy();
    expect((screen.getByLabelText('Buscar por nome') as HTMLInputElement).value).toBe('bia');
    expect((screen.getByLabelText('Situação') as HTMLSelectElement).value).toBe('todos');
    expect(urlDe(f)).toBe('/api/pacientes?q=bia&limit=100');
  });

  it('filtro inválido na URL cai em ativos', async () => {
    const f = mockLista([ana]);
    setup('/app/pacientes?filtro=xyz');
    await screen.findByRole('link', { name: 'Ana Souza' });
    expect((screen.getByLabelText('Situação') as HTMLSelectElement).value).toBe('ativos');
    expect(urlDe(f)).toContain('ativo=true');
  });

  it('sem botão excluir e sem violações de a11y', async () => {
    mockLista([ana, bia]);
    const { container } = setup('/app/pacientes?filtro=todos');
    await screen.findByRole('link', { name: 'Ana Souza' });
    expect(screen.queryByRole('button', { name: /exclu/i })).toBeNull();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Inativar e reativar (PAC-03, PAC-07)', () => {
  function mockSituacao(ativo: boolean, post: 'ok' | 'erro' = 'ok') {
    let atual = ativo;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/eu') return json({ perfil: { completo: true }, csrf_token: 't' });
      if (init?.method === 'POST') {
        if (post === 'erro') return json({ codigo: 'erro_interno' }, 500);
        atual = url.endsWith('/reativar');
        return json({ ...ana, nome: 'Bruno Lima', ativo: atual });
      }
      return json({ ...ana, nome: 'Bruno Lima', ativo: atual });
    });
    vi.stubGlobal('fetch', f);
    return f;
  }
  const posts = (f: ReturnType<typeof vi.fn>) =>
    f.mock.calls
      .filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
      .map((c) => String(c[0]));
  const setup = () =>
    render(
      <QueryClientProvider client={cliente()}>
        <MemoryRouter initialEntries={['/app/pacientes/p1/situacao']}>
          <Routes>
            <Route path="/app/pacientes/:id/situacao" element={<PatientStatusPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('paciente ativo: confirma e inativa; sem opção de excluir; texto E7', async () => {
    const f = mockSituacao(true);
    setup();
    expect(await screen.findByRole('heading', { name: 'Inativar Bruno Lima?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /exclu/i })).toBeNull();
    expect(screen.getByText('Pacientes não podem ser excluídos.')).toBeTruthy();
    expect(screen.getByText(/O prontuário completo é mantido/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Inativar paciente' }));
    expect(await screen.findByText(/Paciente inativado/)).toBeTruthy();
    expect(posts(f)).toEqual(['/api/pacientes/p1/inativar']);
    expect(await screen.findByRole('heading', { name: 'Reativar Bruno Lima?' })).toBeTruthy();
  });

  it('paciente inativo: reativação funciona', async () => {
    const f = mockSituacao(false);
    setup();
    expect(await screen.findByRole('heading', { name: 'Reativar Bruno Lima?' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reativar' }));
    expect(await screen.findByText(/Paciente reativado/)).toBeTruthy();
    expect(posts(f)).toEqual(['/api/pacientes/p1/reativar']);
  });

  it('erro na ação mostra alerta', async () => {
    mockSituacao(true, 'erro');
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Inativar paciente' }));
    expect(await screen.findByText(/Não foi possível concluir a ação/)).toBeTruthy();
  });

  it('sem violações de acessibilidade', async () => {
    mockSituacao(true);
    const { container } = setup();
    await screen.findByRole('heading', { name: 'Inativar Bruno Lima?' });
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Novo paciente (PAC-01)', () => {
  function mockCriar(resposta: () => Response) {
    const chamadas: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, ...(init !== undefined ? { init } : {}) });
        if (url === '/api/eu') return json({ perfil: { completo: true }, csrf_token: 't' });
        return resposta();
      }),
    );
    return chamadas;
  }
  const setup = () =>
    render(
      <QueryClientProvider client={cliente()}>
        <MemoryRouter initialEntries={['/app/pacientes/novo']}>
          <Routes>
            <Route path="/app/pacientes/novo" element={<PatientFormPage />} />
            <Route path="/app/pacientes/:id" element={<h1>Ficha</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  const posts = (chamadas: { url: string; init?: RequestInit }[]) =>
    chamadas.filter((c) => c.init?.method === 'POST');

  it('só o nome é obrigatório; limites do contrato; sem botão excluir; sem violações axe', async () => {
    mockCriar(() => json({}));
    const { container } = setup();
    const campo = (nome: RegExp) => screen.getByRole('textbox', { name: nome });
    expect(campo(/Nome/).hasAttribute('required')).toBe(true);
    expect(campo(/Telefone/).hasAttribute('required')).toBe(false);
    expect(campo(/E-mail/).hasAttribute('required')).toBe(false);
    expect(campo(/Endereço/).hasAttribute('required')).toBe(false);
    expect(campo(/Nome/).getAttribute('maxLength')).toBe('200');
    expect(campo(/Telefone/).getAttribute('maxLength')).toBe('40');
    expect(campo(/E-mail/).getAttribute('maxLength')).toBe('254');
    expect(campo(/Endereço/).getAttribute('maxLength')).toBe('500');
    expect(screen.queryByRole('button', { name: /exclu|delet|remov/i })).toBeNull();
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it('nome vazio mostra erro e não envia', async () => {
    const chamadas = mockCriar(() => json({}));
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert').textContent).toContain('Informe o nome');
    expect(posts(chamadas)).toHaveLength(0);
  });

  it('e-mail fora do formato x@y mostra erro e não envia', async () => {
    const chamadas = mockCriar(() => json({}));
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Ana');
    await userEvent.type(screen.getByRole('textbox', { name: /E-mail/ }), 'ana');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Informe um e-mail válido.')).toBeTruthy();
    expect(posts(chamadas)).toHaveLength(0);
  });

  it('cria só com o nome (aparado, vazios como null) e vai para a ficha', async () => {
    const chamadas = mockCriar(() => json({ ...ana, id: 'p9', nome: 'Ana' }, 201));
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), ' Ana ');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('heading', { name: 'Ficha' });
    const [post] = posts(chamadas);
    expect(post!.url).toBe('/api/pacientes');
    expect(JSON.parse(post!.init!.body as string)).toEqual({
      nome: 'Ana',
      telefone: null,
      email: null,
      endereco: null,
    });
  });

  it('erro genérico em role=alert sem eco de dado', async () => {
    mockCriar(() => json({ codigo: 'erro_interno' }, 500));
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível salvar');
    expect(alerta.textContent).not.toContain('Ana');
  });
});
