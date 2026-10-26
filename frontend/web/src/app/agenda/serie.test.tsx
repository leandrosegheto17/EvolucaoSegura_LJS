import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { AcoesSessao, AgendaComAcoes, NovaSeriePage } from './serie.tsx';

// T88 / AGE-04, AGE-07, AGE-10, AGE-13, AGE-14: criação de série, diálogo de conflito com as
// colisões e ações de status. Casos de features/scheduling/new/NewSessionPage.spec.tsx e
// features/scheduling/detail/SessionDetailPage.spec.tsx do legado, para /api/series e
// /api/sessoes/:id/status.

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

const ana = {
  id: 'p1',
  nome: 'Ana Souza',
  ativo: true,
  telefone: null,
  email: null,
  endereco: null,
  row_version: 1,
  criado_em: '2026-10-01T12:00:00.000Z',
};
const sessao = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 's1',
  paciente_id: 'p1',
  serie_id: null,
  inicio: new Date(2026, 9, 27, 9, 0).toISOString(),
  fim: new Date(2026, 9, 27, 9, 50).toISOString(),
  link: null,
  status,
  cobravel: false,
  row_version: 3,
  criado_em: '2026-10-01T12:00:00.000Z',
  ...extra,
});

type Chamada = { url: string; init?: RequestInit };
const posts = (c: Chamada[], fim: string) =>
  c.filter((x) => x.init?.method === 'POST' && x.url.endsWith(fim));
const corpoDe = (c: Chamada) => JSON.parse(c.init!.body as string);

function mock(resposta: (url: string, init?: RequestInit) => Response | undefined) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, ...(init !== undefined ? { init } : {}) });
      if (url === '/api/eu') return json({ perfil: { completo: true }, csrf_token: 't' });
      if (url.startsWith('/api/pacientes')) return json({ items: [ana], limit: 100, offset: 0 });
      return resposta(url, init) ?? json({});
    }),
  );
  return chamadas;
}

describe('Nova série (AGE-13, AGE-14)', () => {
  const setup = () =>
    render(
      <QueryClientProvider client={cliente()}>
        <MemoryRouter initialEntries={['/app/agenda/serie/nova']}>
          <Routes>
            <Route path="/app/agenda/serie/nova" element={<NovaSeriePage />} />
            <Route path="/app/agenda" element={<h1>Agenda da semana</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  async function preencher(total = '4') {
    await screen.findByRole('option', { name: 'Ana Souza' });
    await userEvent.selectOptions(screen.getByLabelText(/Paciente/), 'p1');
    fireEvent.change(screen.getByLabelText(/Data/), { target: { value: '2026-10-27' } });
    fireEvent.change(screen.getByLabelText(/Hora/), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText(/Ocorrências/), { target: { value: total } });
  }
  const colisoes = [
    { ocorrencia: 2, inicio: new Date(2026, 10, 3, 9, 0).toISOString(), sessao_id: 'x2' },
    { ocorrencia: 4, inicio: new Date(2026, 10, 17, 9, 0).toISOString(), sessao_id: 'x4' },
  ];

  it('envia a série com frequência, ocorrências e duração de 50 min (AGE-13)', async () => {
    const c = mock(() => json({ serie: {}, sessoes: [] }, 201));
    setup();
    await preencher('6');
    await userEvent.click(screen.getByLabelText('A cada 15 dias'));
    await userEvent.click(screen.getByRole('button', { name: 'Agendar série' }));
    await screen.findByRole('heading', { name: 'Agenda da semana' });
    const inicio = new Date(2026, 9, 27, 9, 0);
    expect(corpoDe(posts(c, '/api/series')[0]!)).toEqual({
      paciente_id: 'p1',
      inicio: inicio.toISOString(),
      fim: new Date(inicio.getTime() + 50 * 60_000).toISOString(),
      link: null,
      frequencia: 'quinzenal',
      ocorrencias: 6,
    });
  });

  it.each(['1', '53', ''])('ocorrências %j (fora de 2 a 52) não envia', async (total) => {
    const c = mock(() => json({}, 201));
    setup();
    await preencher(total);
    await userEvent.click(screen.getByRole('button', { name: 'Agendar série' }));
    expect(screen.getByText('Informe de 2 a 52 ocorrências.')).toBeTruthy();
    expect(posts(c, '/api/series')).toHaveLength(0);
  });

  it('52 ocorrências são aceitas', async () => {
    const c = mock(() => json({ serie: {}, sessoes: [] }, 201));
    setup();
    await preencher('52');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar série' }));
    await screen.findByRole('heading', { name: 'Agenda da semana' });
    expect(corpoDe(posts(c, '/api/series')[0]!).ocorrencias).toBe(52);
  });

  it('409 lista todas as colisões e "Criar mesmo assim" reenvia com confirmar_conflito (AGE-14)', async () => {
    let n = 0;
    const c = mock(() =>
      ++n === 1
        ? json({ codigo: 'SCHEDULE_CONFLICT', titulo: 'Conflito de horário', colisoes }, 409)
        : json({ serie: {}, sessoes: [] }, 201),
    );
    setup();
    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Agendar série' }));
    const dialogo = await screen.findByRole('alertdialog');
    const itens = within(dialogo).getAllByRole('listitem');
    expect(itens.map((i) => i.textContent)).toEqual([
      'Ocorrência 2: 03/11/2026 às 09:00',
      'Ocorrência 4: 17/11/2026 às 09:00',
    ]);
    expect(corpoDe(posts(c, '/api/series')[0]!).confirmar_conflito).toBeUndefined();
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Criar mesmo assim' }));
    await screen.findByRole('heading', { name: 'Agenda da semana' });
    expect(corpoDe(posts(c, '/api/series')[1]!).confirmar_conflito).toBe(true);
  });

  it('"Escolher outro horário" fecha o diálogo sem criar nada', async () => {
    const c = mock(() => json({ codigo: 'SCHEDULE_CONFLICT', colisoes }, 409));
    setup();
    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Agendar série' }));
    const dialogo = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Escolher outro horário' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(posts(c, '/api/series')).toHaveLength(1);
  });

  it('erro do contrato é exibido', async () => {
    mock(() => json({ codigo: 'PATIENT_INACTIVE' }, 422));
    setup();
    await preencher();
    await userEvent.click(screen.getByRole('button', { name: 'Agendar série' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/paciente está inativo/);
  });

  it('sem violações de acessibilidade', async () => {
    mock(() => json({}));
    const { container } = setup();
    await screen.findByRole('option', { name: 'Ana Souza' });
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Ações de status (AGE-07, AGE-10)', () => {
  const setup = (s: ReturnType<typeof sessao>) =>
    render(
      <QueryClientProvider client={cliente()}>
        <AcoesSessao sessao={s as never} />
      </QueryClientProvider>,
    );
  const botoes = () => screen.getAllByRole('button').map((b) => b.textContent);

  // AGE-07: agendada → realizada, faltou, cancelada ou remarcada; realizada → agendada, faltou ou
  // cancelada; faltou → agendada ou realizada; cancelada → agendada; remarcada → agendada.
  it.each([
    [
      'agendada',
      ['Marcar como realizada', 'Marcar falta', 'Cancelar sessão', 'Marcar como remarcada'],
    ],
    ['realizada', ['Voltar para agendada', 'Marcar falta', 'Cancelar sessão']],
    ['faltou', ['Voltar para agendada', 'Marcar como realizada']],
    ['cancelada', ['Voltar para agendada']],
    ['remarcada', ['Voltar para agendada']],
  ])('de %s só mostra as transições válidas', (status, esperado) => {
    mock(() => json({}));
    setup(sessao(status));
    expect(botoes()).toEqual(esperado);
  });

  it.each([
    ['faltou', true],
    ['cancelada', true],
    ['agendada', true],
    ['realizada', true],
    ['remarcada', false],
  ])('"Cobrar" em %s: visível = %s', (status, visivel) => {
    mock(() => json({}));
    setup(sessao(status));
    expect(screen.queryByRole('checkbox', { name: 'Cobrar' }) !== null).toBe(visivel);
  });

  it('marcar falta sem "Cobrar" manda cobravel falso e a versão (AGE-10)', async () => {
    const c = mock(() => json(sessao('faltou')));
    setup(sessao('agendada'));
    await userEvent.click(screen.getByRole('button', { name: 'Marcar falta' }));
    await vi.waitFor(() => expect(posts(c, '/status')).toHaveLength(1));
    expect(posts(c, '/status')[0]!.url).toBe('/api/sessoes/s1/status');
    expect(corpoDe(posts(c, '/status')[0]!)).toEqual({
      status: 'faltou',
      cobravel: false,
      row_version: 3,
    });
  });

  it('cancelar com "Cobrar" marcado manda cobravel verdadeiro (AGE-10)', async () => {
    const c = mock(() => json(sessao('cancelada')));
    setup(sessao('agendada'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cobrar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar sessão' }));
    await vi.waitFor(() => expect(posts(c, '/status')).toHaveLength(1));
    expect(corpoDe(posts(c, '/status')[0]!)).toEqual({
      status: 'cancelada',
      cobravel: true,
      row_version: 3,
    });
  });

  it('marcar realizada não manda cobravel', async () => {
    const c = mock(() => json(sessao('realizada')));
    setup(sessao('agendada'));
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como realizada' }));
    await vi.waitFor(() => expect(posts(c, '/status')).toHaveLength(1));
    expect(corpoDe(posts(c, '/status')[0]!)).toEqual({ status: 'realizada', row_version: 3 });
  });

  it('em falta, marcar "Cobrar" grava na própria sessão (mesmo status)', async () => {
    const c = mock(() => json(sessao('faltou', { cobravel: true })));
    setup(sessao('faltou'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cobrar' }));
    await vi.waitFor(() => expect(posts(c, '/status')).toHaveLength(1));
    expect(corpoDe(posts(c, '/status')[0]!)).toEqual({
      status: 'faltou',
      cobravel: true,
      row_version: 3,
    });
  });

  it('reabrir com horário ocupado (409) pede confirmação e reenvia com confirmar_conflito (AGE-04)', async () => {
    let n = 0;
    const c = mock(() =>
      ++n === 1 ? json({ codigo: 'SCHEDULE_CONFLICT' }, 409) : json(sessao('agendada')),
    );
    setup(sessao('cancelada'));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para agendada' }));
    expect(await screen.findByText('Já existe sessão neste horário.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar mesmo assim' }));
    await vi.waitFor(() => expect(posts(c, '/status')).toHaveLength(2));
    expect(corpoDe(posts(c, '/status')[1]!)).toEqual({
      status: 'agendada',
      row_version: 3,
      confirmar_conflito: true,
    });
  });

  it.each([
    ['SESSION_HAS_RECORDS', 422, /evolução ou pagamento/],
    ['versao_divergente', 409, /Alguém alterou esta sessão/],
    ['erro_interno', 500, /Não foi possível alterar a sessão/],
  ])('erro %s do contrato é exibido', async (codigo, status, texto) => {
    mock(() => json({ codigo }, status));
    setup(sessao('realizada'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar sessão' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(texto);
  });
});

describe('Agenda com ações', () => {
  it('cada sessão da semana mostra as ações da sua situação e a agenda leva a "Nova série"', async () => {
    mock((url) =>
      url.startsWith('/api/sessoes')
        ? json({ items: [sessao('faltou')], proximo_cursor: null })
        : undefined,
    );
    const { container } = render(
      <QueryClientProvider client={cliente()}>
        <MemoryRouter initialEntries={['/app/agenda?semana=2026-10-26']}>
          <AgendaComAcoes />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Marcar como realizada' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Cobrar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nova série' }).getAttribute('href')).toBe(
      '/app/agenda/serie/nova',
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
