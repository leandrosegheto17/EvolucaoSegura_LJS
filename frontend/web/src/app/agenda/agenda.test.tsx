import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { AgendaPage, NovaSessaoPage } from './agenda.tsx';

// T87 / AGE-01, AGE-02, AGE-03, AGE-04, AGE-06, AGE-12: agenda da semana e nova sessão. Casos de
// scheduling/agenda/AgendaPage.spec.tsx e features/scheduling/new/NewSessionPage.spec.tsx do
// legado, para /api/sessoes: durações 30, 45, 50, 60 e 90 com 50 pré-selecionado, início e fim em
// ISO com offset, link opcional http(s), semana na URL e os erros do contrato na tela.

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
const ana = { ...P, id: 'p1', nome: 'Ana Souza', ativo: true };
const sessao = (id: string, inicio: Date, minutos: number, status = 'agendada') => ({
  id,
  paciente_id: 'p1',
  serie_id: null,
  inicio: inicio.toISOString(),
  fim: new Date(inicio.getTime() + minutos * 60_000).toISOString(),
  link: null,
  status,
  cobravel: false,
  row_version: 1,
  criado_em: '2026-10-01T12:00:00.000Z',
});
// Semana de segunda 26/10/2026 (horário local do teste).
const SEGUNDA = new Date(2026, 9, 26);
const PROXIMA = new Date(2026, 10, 2);

describe('Agenda da semana (AGE-03)', () => {
  function mock(sessoes: unknown[] | 'erro') {
    const f = vi.fn(async (url: string) => {
      if (url.startsWith('/api/sessoes'))
        return sessoes === 'erro'
          ? json({ codigo: 'erro_interno' }, 500)
          : json({ items: sessoes, proximo_cursor: null });
      return json({ items: [ana], limit: 100, offset: 0 });
    });
    vi.stubGlobal('fetch', f);
    return f;
  }
  function Onde() {
    const l = useLocation();
    return <output data-testid="loc">{l.pathname + l.search}</output>;
  }
  const setup = (url = '/app/agenda?semana=2026-10-26') =>
    render(
      <QueryClientProvider client={cliente()}>
        <MemoryRouter initialEntries={[url]}>
          <AgendaPage />
          <Onde />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('pede o intervalo da semana [segunda, próxima segunda) e mostra horário, paciente e situação', async () => {
    const f = mock([sessao('s1', new Date(2026, 9, 27, 9, 0), 50)]);
    setup();
    expect(await screen.findByText('09:00–09:50')).toBeTruthy();
    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('Agendada')).toBeTruthy();
    const url = f.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/sessoes'))!;
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('de')).toBe(SEGUNDA.toISOString());
    expect(qs.get('ate')).toBe(PROXIMA.toISOString());
    expect(qs.get('limit')).toBe('100');
    expect(screen.getByRole('heading', { name: /^terça, 27\/10$/ })).toBeTruthy();
  });

  it('semana vazia convida a criar a sessão; "Nova sessão" leva ao formulário', async () => {
    mock([]);
    setup();
    expect(await screen.findByText('Nenhuma sessão nesta semana.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Nova sessão' })[0]!.getAttribute('href')).toBe(
      '/app/agenda/nova',
    );
  });

  it('navegação da semana vai para a URL (anterior e próxima)', async () => {
    mock([]);
    setup();
    await screen.findByText('Nenhuma sessão nesta semana.');
    await userEvent.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(screen.getByTestId('loc').textContent).toBe('/app/agenda?semana=2026-11-02');
    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(screen.getByTestId('loc').textContent).toBe('/app/agenda?semana=2026-10-19');
  });

  it('erro ao carregar com nova tentativa', async () => {
    const f = mock('erro');
    setup();
    expect(await screen.findByText('Não foi possível carregar a agenda.')).toBeTruthy();
    f.mockImplementation(async (url: string) =>
      url.startsWith('/api/sessoes')
        ? json({ items: [sessao('s1', new Date(2026, 9, 27, 9, 0), 50)], proximo_cursor: null })
        : json({ items: [ana], limit: 100, offset: 0 }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('09:00–09:50')).toBeTruthy();
  });

  it('sem violações de acessibilidade', async () => {
    mock([sessao('s1', new Date(2026, 9, 27, 9, 0), 50)]);
    const { container } = setup();
    await screen.findByText('09:00–09:50');
    expect((await axe(container)).violations).toEqual([]);
  });

  // T205 / EVO-03: a evolução só fica ligada à sessão quando a tela recebe ?sessao=<id>. Cada
  // sessão da agenda ganha o link "Evolução" com o id dela, salvo cancelada e remarcada (o mesmo
  // critério da lista de hoje do Início).
  it('"Evolução" de cada sessão leva à evolução do paciente com ?sessao=<id dela> (EVO-03)', async () => {
    mock([
      sessao('s1', new Date(2026, 9, 27, 9, 0), 50, 'agendada'),
      sessao('s2', new Date(2026, 9, 27, 11, 0), 50, 'realizada'),
      sessao('s3', new Date(2026, 9, 28, 15, 0), 50, 'faltou'),
    ]);
    setup();
    const linha = async (h: string) => (await screen.findByText(h)).closest('li')!;
    const href = async (h: string) =>
      within(await linha(h))
        .getByRole('link', { name: 'Evolução' })
        .getAttribute('href');
    expect(await href('09:00–09:50')).toBe('/app/pacientes/p1/evolucao?sessao=s1');
    expect(await href('11:00–11:50')).toBe('/app/pacientes/p1/evolucao?sessao=s2');
    expect(await href('15:00–15:50')).toBe('/app/pacientes/p1/evolucao?sessao=s3');
    fireEvent.click(within(await linha('11:00–11:50')).getByRole('link', { name: 'Evolução' }));
    expect(screen.getByTestId('loc').textContent).toBe('/app/pacientes/p1/evolucao?sessao=s2');
  });

  it('sessão cancelada ou remarcada não tem o link "Evolução" (EVO-03)', async () => {
    mock([
      sessao('s1', new Date(2026, 9, 27, 9, 0), 50, 'cancelada'),
      sessao('s2', new Date(2026, 9, 27, 11, 0), 50, 'remarcada'),
      sessao('s3', new Date(2026, 9, 27, 14, 0), 50, 'agendada'),
    ]);
    setup();
    const linha = async (h: string) => (await screen.findByText(h)).closest('li')!;
    expect(within(await linha('09:00–09:50')).queryByRole('link', { name: 'Evolução' })).toBeNull();
    expect(within(await linha('11:00–11:50')).queryByRole('link', { name: 'Evolução' })).toBeNull();
    expect(within(await linha('14:00–14:50')).getByRole('link', { name: 'Evolução' })).toBeTruthy();
  });
});

describe('Nova sessão (AGE-01, AGE-02, AGE-04, AGE-06, AGE-12)', () => {
  function mock(resposta: () => Response) {
    const chamadas: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, ...(init !== undefined ? { init } : {}) });
        if (url === '/api/eu') return json({ perfil: { completo: true }, csrf_token: 't' });
        if (url.startsWith('/api/pacientes')) return json({ items: [ana], limit: 100, offset: 0 });
        return resposta();
      }),
    );
    return chamadas;
  }
  const posts = (c: { url: string; init?: RequestInit }[]) =>
    c.filter((x) => x.init?.method === 'POST' && x.url === '/api/sessoes');
  const corpoDe = (c: { init?: RequestInit }) => JSON.parse(c.init!.body as string);
  const setup = () =>
    render(
      <QueryClientProvider client={cliente()}>
        <MemoryRouter initialEntries={['/app/agenda/nova']}>
          <Routes>
            <Route path="/app/agenda/nova" element={<NovaSessaoPage />} />
            <Route path="/app/agenda" element={<h1>Agenda da semana</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  async function preencher() {
    await screen.findByRole('option', { name: 'Ana Souza' });
    await userEvent.selectOptions(screen.getByLabelText(/Paciente/), 'p1');
    fireEvent.change(screen.getByLabelText(/Data/), { target: { value: '2026-10-27' } });
    fireEvent.change(screen.getByLabelText(/Hora/), { target: { value: '09:00' } });
  }

  it('durações 30, 45, 50, 60 e 90 com 50 pré-selecionado (AGE-02)', async () => {
    mock(() => json({}));
    setup();
    await screen.findByRole('option', { name: 'Ana Souza' });
    const duracao = screen.getByLabelText('Duração') as HTMLSelectElement;
    expect(duracao.value).toBe('50');
    expect(
      within(duracao)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['30 min', '45 min', '50 min', '60 min', '90 min']);
  });

  it('cria com a duração padrão: fim = início + 50 min em ISO, link nulo, e volta à agenda (AGE-01)', async () => {
    const chamadas = mock(() => json(sessao('s1', new Date(2026, 9, 27, 9, 0), 50), 201));
    setup();
    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    await screen.findByRole('heading', { name: 'Agenda da semana' });
    const inicio = new Date(2026, 9, 27, 9, 0);
    expect(corpoDe(posts(chamadas)[0]!)).toEqual({
      paciente_id: 'p1',
      inicio: inicio.toISOString(),
      fim: new Date(inicio.getTime() + 50 * 60_000).toISOString(),
      link: null,
    });
  });

  it('usa a duração escolhida e o link aparado', async () => {
    const chamadas = mock(() => json(sessao('s1', new Date(2026, 9, 27, 9, 0), 90), 201));
    setup();
    await preencher();
    await userEvent.selectOptions(screen.getByLabelText('Duração'), '90');
    await userEvent.type(screen.getByLabelText(/Link/), ' https://exemplo.invalid/sala ');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    await screen.findByRole('heading', { name: 'Agenda da semana' });
    const c = corpoDe(posts(chamadas)[0]!);
    expect(Date.parse(c.fim) - Date.parse(c.inicio)).toBe(90 * 60_000);
    expect(c.link).toBe('https://exemplo.invalid/sala');
  });

  it('campos obrigatórios e link fora de http(s) mostram erro e não enviam (AGE-01)', async () => {
    const chamadas = mock(() => json({}));
    setup();
    await screen.findByRole('option', { name: 'Ana Souza' });
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    expect(screen.getByText('Escolha o paciente.')).toBeTruthy();
    expect(screen.getByText('Escolha uma data.')).toBeTruthy();
    expect(screen.getByText('Informe a hora.')).toBeTruthy();
    await preencher();
    await userEvent.type(screen.getByLabelText(/Link/), 'ftp://x');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    expect(screen.getByText('Informe um link começando com http:// ou https://.')).toBeTruthy();
    expect(posts(chamadas)).toHaveLength(0);
  });

  it('409 SCHEDULE_CONFLICT: avisa, e "Agendar mesmo assim" reenvia com confirmar_conflito (AGE-04)', async () => {
    let n = 0;
    const chamadas = mock(() =>
      ++n === 1
        ? json({ codigo: 'SCHEDULE_CONFLICT', titulo: 'Conflito de horário' }, 409)
        : json(sessao('s1', new Date(2026, 9, 27, 9, 0), 50), 201),
    );
    setup();
    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    expect(await screen.findByText('Já existe sessão neste horário.')).toBeTruthy();
    expect(corpoDe(posts(chamadas)[0]!).confirmar_conflito).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Agendar mesmo assim' }));
    await screen.findByRole('heading', { name: 'Agenda da semana' });
    expect(corpoDe(posts(chamadas)[1]!).confirmar_conflito).toBe(true);
  });

  it.each([
    ['WEEKDAY_UNAVAILABLE', 422, /não atende neste dia da semana/],
    ['PATIENT_INACTIVE', 422, /paciente está inativo/],
    ['validacao', 422, /Confira data, hora e link/],
    ['erro_interno', 500, /Não foi possível agendar agora\. Nada foi criado/],
  ])('erro %s do contrato é exibido', async (codigo, status, texto) => {
    mock(() => json({ codigo }, status));
    setup();
    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(texto);
  });

  it('sem violações de acessibilidade', async () => {
    mock(() => json({}));
    const { container } = setup();
    await screen.findByRole('option', { name: 'Ana Souza' });
    expect((await axe(container)).violations).toEqual([]);
  });
});
