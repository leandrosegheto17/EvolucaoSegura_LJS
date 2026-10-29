import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { Inicio } from './inicio.tsx';

// T117 / INI-01, INI-02, INI-03: Início (/app). Casos de home/HomePage.spec.tsx e
// home/TodayList.spec.tsx do legado, para GET /api/inicio: semana e contadores iguais à API,
// lista de hoje (até 6) com selos de evolução (quatro estados) e de pagamento (três estados) e o
// alerta de evolução editável de hoje sem texto.

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

const sessao = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `s${n}`,
  inicio: '2026-10-26T13:00:00.000Z',
  fim: '2026-10-26T13:50:00.000Z',
  status: 'realizada',
  paciente: { id: `p${n}`, nome: `Paciente ${n}` },
  evolucao: 'registrada',
  pagamento: 'pago',
  ...extra,
});

const resumo = (sobre: Record<string, unknown> = {}) => ({
  semana: {
    inicio: '2026-10-26',
    fim: '2026-11-01',
    total: 9,
    realizadas: 4,
    pendentes_evolucao: 3,
    pendentes_pagamento: 2,
  },
  hoje: [sessao(1)],
  hoje_total: 1,
  alerta: { editavel_hoje_sem_texto: 0 },
  ...sobre,
});

function mock(corpo: unknown | 'erro') {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url.startsWith('/api/perfil')) return json({ nome: 'Maria Lima' });
    return corpo === 'erro' ? json({ codigo: 'erro_interno' }, 500) : json(corpo);
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Inicio />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const cartao = (rotulo: string) => screen.getAllByText(rotulo)[0]!.closest('div')!;

describe('Início: semana e contadores (INI-01)', () => {
  it('mostra a semana e os contadores iguais aos da API', async () => {
    const f = mock(resumo());
    setup();
    await screen.findByText('Esta semana');
    expect(f.mock.calls.some((c) => String(c[0]) === '/api/inicio')).toBe(true);
    expect(screen.getByText(/26\/10 a 01\/11/)).toBeTruthy();
    expect(within(cartao('Sessões na semana')).getByText('9')).toBeTruthy();
    expect(within(cartao('Sessões na semana')).getByText('1 hoje')).toBeTruthy();
    expect(
      within(cartao('Realizadas')).getByText('4 de 9', { selector: 'p.font-heading' }),
    ).toBeTruthy();
    expect(within(cartao('Evoluções a registrar')).getByText('3')).toBeTruthy();
    expect(within(cartao('Pagamentos em aberto')).getByText('2')).toBeTruthy();
  });

  it('semana sem sessões mostra o estado vazio, sem contadores', async () => {
    mock(
      resumo({
        semana: {
          inicio: '2026-10-26',
          fim: '2026-11-01',
          total: 0,
          realizadas: 0,
          pendentes_evolucao: 0,
          pendentes_pagamento: 0,
        },
        hoje: [],
        hoje_total: 0,
      }),
    );
    setup();
    expect(await screen.findByText('Você ainda não tem sessões nesta semana.')).toBeTruthy();
    expect(screen.queryByText('Esta semana')).toBeNull();
  });

  it('falha da API mostra o erro', async () => {
    mock('erro');
    setup();
    expect(await screen.findByText('Não foi possível carregar o resumo da semana.')).toBeTruthy();
  });
});

describe('Início: lista de hoje (INI-02, INI-03)', () => {
  it('lista as sessões da API com selos de evolução e de pagamento', async () => {
    mock(
      resumo({
        hoje: [
          sessao(1, { evolucao: 'sem_registro', pagamento: 'pendente' }),
          sessao(2, { evolucao: 'editavel_hoje_sem_texto', pagamento: 'nao_cobravel' }),
          sessao(3, { evolucao: 'editavel_hoje', pagamento: 'pago' }),
          sessao(4, { evolucao: 'registrada', pagamento: 'pago' }),
        ],
        hoje_total: 4,
        alerta: { editavel_hoje_sem_texto: 1 },
      }),
    );
    setup();
    await screen.findByText('Paciente 1');
    const linha = (n: number) => screen.getByText(`Paciente ${n}`).closest('li')!;
    expect(within(linha(1)).getByText('Sem registro')).toBeTruthy();
    expect(within(linha(1)).getByText('Pagamento pendente')).toBeTruthy();
    expect(within(linha(2)).getByText('Editável hoje, sem texto')).toBeTruthy();
    expect(within(linha(2)).getByText('Não cobrável')).toBeTruthy();
    expect(within(linha(3)).getByText('Editável hoje')).toBeTruthy();
    expect(within(linha(3)).getByText('Pago')).toBeTruthy();
    expect(within(linha(4)).getByText('Registrada')).toBeTruthy();
    const link = within(linha(1)).getByRole('link', { name: /Evolução/ });
    expect(link.getAttribute('href')).toBe('/app/pacientes/p1/evolucao?sessao=s1');
  });

  it('mostra as 6 sessões recebidas e "Ver todas (8)" quando hoje_total é 8', async () => {
    mock(
      resumo({
        hoje: [1, 2, 3, 4, 5, 6].map((n) => sessao(n)),
        hoje_total: 8,
      }),
    );
    setup();
    await screen.findByText('Paciente 6');
    expect(screen.getAllByText(/^Paciente \d$/)).toHaveLength(6);
    const todas = screen.getByRole('link', { name: 'Ver todas (8)' });
    expect(todas.getAttribute('href')).toBe('/app/agenda');
  });

  it('sem sessões hoje mostra "Nenhuma sessão hoje." e sem "Ver todas"', async () => {
    mock(resumo({ hoje: [], hoje_total: 0 }));
    setup();
    expect(await screen.findByText('Nenhuma sessão hoje.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ver todas/ })).toBeNull();
  });
});

describe('Início: alerta de evolução editável sem texto (INI-03)', () => {
  it('com contagem 2 mostra o alerta no plural e leva à primeira evolução pendente', async () => {
    mock(
      resumo({
        hoje: [sessao(1), sessao(2, { evolucao: 'editavel_hoje_sem_texto' })],
        hoje_total: 2,
        alerta: { editavel_hoje_sem_texto: 2 },
      }),
    );
    setup();
    const alerta = (await screen.findByText(/2 evoluções editáveis hoje ainda sem texto/)).closest(
      '[role=status]',
    ) as HTMLElement;
    const abrir = within(alerta).getByRole('link', { name: 'Abrir' });
    expect(abrir.getAttribute('href')).toBe('/app/pacientes/p2/evolucao?sessao=s2');
  });

  it('com contagem 1 usa o singular', async () => {
    mock(resumo({ alerta: { editavel_hoje_sem_texto: 1 } }));
    setup();
    expect(await screen.findByText(/1 evolução editável hoje ainda sem texto/)).toBeTruthy();
  });

  it('com contagem 0 não mostra o alerta', async () => {
    mock(resumo());
    setup();
    await screen.findByText('Esta semana');
    expect(screen.queryByText(/ainda sem texto/)).toBeNull();
  });
});

describe('Início: acessibilidade', () => {
  it('sem violações axe', async () => {
    mock(
      resumo({
        hoje: [sessao(1, { evolucao: 'editavel_hoje_sem_texto', pagamento: 'pendente' })],
        alerta: { editavel_hoje_sem_texto: 1 },
      }),
    );
    const { container } = setup();
    await screen.findByText('Paciente 1');
    expect((await axe(container)).violations).toEqual([]);
  });
});

// T168 / FIN-09, INI-03: atalho "Pagamento" na lista de hoje (no legado, TodayList levava à página
// de pagamento da sessão).
describe('Início: atalho Pagamento (FIN-09)', () => {
  it('aparece só na sessão com pagamento pendente e leva à tela de pagamento da sessão', async () => {
    mock(
      resumo({
        hoje: [
          sessao(1, { pagamento: 'pendente' }),
          sessao(2, { pagamento: 'pago' }),
          sessao(3, { pagamento: 'nao_cobravel' }),
        ],
        hoje_total: 3,
      }),
    );
    setup();
    await screen.findByText('Paciente 1');
    const linha = (n: number) => screen.getByText(`Paciente ${n}`).closest('li')!;
    const atalho = within(linha(1)).getByRole('link', { name: 'Pagamento' });
    expect(atalho.getAttribute('href')).toBe('/app/financeiro/pagamento/s1');
    expect(within(linha(2)).queryByRole('link', { name: 'Pagamento' })).toBeNull();
    expect(within(linha(3)).queryByRole('link', { name: 'Pagamento' })).toBeNull();
  });
});

// T204 / EVO-03: a evolução só fica ligada à sessão (e a sessão vira realizada) quando a tela de
// evolução recebe ?sessao=<id>. Os links do Início precisam levar a sessão; o teste clica e confere
// o destino que a rota da evolução recebe.
function DestinoEvolucao() {
  const { id } = useParams();
  const { search } = useLocation();
  return (
    <p data-testid="destino">
      paciente={id};sessao={new URLSearchParams(search).get('sessao') ?? '(nenhuma)'}
    </p>
  );
}
const setupComRotas = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<Inicio />} />
          <Route path="/app/pacientes/:id/evolucao" element={<DestinoEvolucao />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Início: links da evolução levam a sessão (EVO-03)', () => {
  it('clicar em "Evolução" de uma sessão abre a evolução do paciente com ?sessao=<id dela>', async () => {
    mock(
      resumo({
        hoje: [sessao(1), sessao(2, { id: 'sessao-b', paciente: { id: 'pac-b', nome: 'Bia' } })],
        hoje_total: 2,
      }),
    );
    setupComRotas();
    const linha = (await screen.findByText('Bia')).closest('li')!;
    fireEvent.click(within(linha).getByRole('link', { name: 'Evolução' }));
    expect((await screen.findByTestId('destino')).textContent).toBe(
      'paciente=pac-b;sessao=sessao-b',
    );
  });

  it('clicar em "Abrir" do alerta abre a evolução da primeira sessão sem texto com ?sessao=<id dela>', async () => {
    mock(
      resumo({
        hoje: [
          sessao(1),
          sessao(2, { evolucao: 'editavel_hoje_sem_texto' }),
          sessao(3, { evolucao: 'editavel_hoje_sem_texto' }),
        ],
        hoje_total: 3,
        alerta: { editavel_hoje_sem_texto: 2 },
      }),
    );
    setupComRotas();
    const alerta = (await screen.findByText(/2 evoluções editáveis hoje ainda sem texto/)).closest(
      '[role=status]',
    ) as HTMLElement;
    fireEvent.click(within(alerta).getByRole('link', { name: 'Abrir' }));
    expect((await screen.findByTestId('destino')).textContent).toBe('paciente=p2;sessao=s2');
  });

  it('id de sessão com caractere reservado vai codificado e chega íntegro', async () => {
    mock(resumo({ hoje: [sessao(1, { id: 'a&b=c d' })], hoje_total: 1 }));
    setupComRotas();
    const linha = (await screen.findByText('Paciente 1')).closest('li')!;
    fireEvent.click(within(linha).getByRole('link', { name: 'Evolução' }));
    expect((await screen.findByTestId('destino')).textContent).toBe('paciente=p1;sessao=a&b=c d');
  });
});

// T210 / PERF-08: a privacidade da agenda vale só para a agenda; o Início continua com o nome.
describe('Início com a privacidade da agenda ligada (PERF-08)', () => {
  it('mostra o nome completo do paciente', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.startsWith('/api/perfil')) return json({ nome: 'Maria Lima' });
      if (url.startsWith('/api/configuracoes')) return json({ privacidade_agenda: true });
      return json(resumo({ hoje: [sessao(1)], hoje_total: 1 }));
    });
    vi.stubGlobal('fetch', f);
    const { container } = setup();
    expect(await screen.findByText('Paciente 1')).toBeTruthy();
    expect(container.textContent).not.toContain('P. 1.');
  });
});
