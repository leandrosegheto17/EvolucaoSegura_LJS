import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { AuditoriaPage } from './auditoria.tsx';

// T119 / AUD-03: tela /app/auditoria. Casos de features/audit/AuditPage.spec.tsx do legado, para
// GET /api/auditoria: duas visões (conta e paciente), filtro no servidor, "Carregar mais" com o
// cursor, vazio, erro e nenhum conteúdo clínico nem paciente.consultado.

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
const ev = (id: string, acao: string, extra = {}) => ({
  id,
  acao,
  alvo_tipo: 'evolucao',
  alvo_id: null,
  campos_alterados: [],
  origem_ip: '203.0.113.0',
  origem_ua: 'x',
  ocorrido_em: '2026-09-20T10:00:00Z',
  ...extra,
});
const mock = (...respostas: Response[]) => {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  respostas.forEach((r) => f.mockResolvedValueOnce(r));
  f.mockImplementation(async () => json({ items: [], proximo_cursor: null }));
  vi.stubGlobal('fetch', f);
  return f;
};
const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

function Onde() {
  const l = useLocation();
  return <output data-testid="loc">{l.pathname + l.search}</output>;
}
const setup = (url = '/app/auditoria') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <AuditoriaPage />
        <Onde />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Auditoria: duas visões (AUD-03)', () => {
  it('sem paciente mostra "Trilha da minha conta" e consulta /api/auditoria', async () => {
    const f = mock(
      json({
        items: [ev('2', 'auth.login_falhou'), ev('1', 'perfil.editado')],
        proximo_cursor: null,
      }),
    );
    setup();
    expect(await screen.findByText('Alteração do perfil')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Trilha da minha conta' })).toBeTruthy();
    expect(urls(f)[0]).toBe('/api/auditoria');
    expect(screen.getByText('Falha')).toBeTruthy();
    expect(screen.getByText('Sucesso')).toBeTruthy();
  });

  it('com ?paciente= mostra "Histórico do paciente" e consulta com paciente_id', async () => {
    const f = mock(
      json({
        items: [
          ev('1', 'evolucao.retificada', {
            campos_alterados: ['texto'],
            conteudo: 'SEGREDO CLINICO',
          }),
        ],
        proximo_cursor: null,
      }),
    );
    const { container } = setup('/app/auditoria?paciente=p1');
    expect(await screen.findByText('Evolução retificada')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Histórico do paciente' })).toBeTruthy();
    expect(urls(f)[0]).toBe('/api/auditoria?paciente_id=p1');
    expect(screen.getByText('Campos: texto')).toBeTruthy();
    expect(screen.queryByText(/SEGREDO/)).toBeNull();
    expect(container.querySelectorAll('textarea, input').length).toBe(0);
  });

  it('ação desconhecida aparece com o texto cru e paciente.consultado nunca é exibido', async () => {
    mock(
      json({
        items: [ev('2', 'coisa.nova'), ev('1', 'paciente.consultado')],
        proximo_cursor: null,
      }),
    );
    setup();
    expect(await screen.findByText('coisa.nova')).toBeTruthy();
    expect(screen.queryByText('Ficha consultada')).toBeNull();
    expect(screen.queryByText('paciente.consultado')).toBeNull();
  });
});

describe('Auditoria: filtros e "Carregar mais" (AUD-03)', () => {
  it('o filtro vai ao servidor, fica na URL e "Todos" a limpa', async () => {
    const f = mock();
    setup('/app/auditoria?paciente=p1');
    await screen.findByText('Nenhum evento registrado');
    const select = screen.getByLabelText('Tipo');
    await userEvent.selectOptions(select, 'retificacoes');
    expect(screen.getByTestId('loc').textContent).toBe(
      '/app/auditoria?filtro=retificacoes&paciente=p1',
    );
    await vi.waitFor(() =>
      expect(urls(f)).toContain('/api/auditoria?paciente_id=p1&filtro=retificacoes'),
    );
    await userEvent.selectOptions(select, 'exportacoes');
    await vi.waitFor(() =>
      expect(urls(f)).toContain('/api/auditoria?paciente_id=p1&filtro=exportacoes'),
    );
    await userEvent.selectOptions(select, 'todos');
    expect(screen.getByTestId('loc').textContent).toBe('/app/auditoria?paciente=p1');
  });

  it('lê o filtro da URL; valor desconhecido cai em todos', async () => {
    const f = mock();
    setup('/app/auditoria?filtro=exportacoes');
    await screen.findByText('Nenhum evento neste filtro');
    expect(urls(f)[0]).toBe('/api/auditoria?filtro=exportacoes');
    cleanup();
    const g = mock();
    setup('/app/auditoria?filtro=xyz');
    await screen.findByText('Nenhum evento registrado');
    expect(urls(g)[0]).toBe('/api/auditoria');
  });

  it('"Carregar mais" usa o cursor, acrescenta a página e some na última', async () => {
    const f = mock(
      json({ items: [ev('2', 'perfil.editado')], proximo_cursor: '2' }),
      json({ items: [ev('1', 'exportacao.concluida')], proximo_cursor: null }),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Exportação concluída')).toBeTruthy();
    expect(screen.getByText('Alteração do perfil')).toBeTruthy();
    expect(urls(f)[1]).toBe('/api/auditoria?cursor=2');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });
});

describe('Auditoria: vazio, erro e acessibilidade', () => {
  it('vazio', async () => {
    mock();
    setup();
    expect(await screen.findByText('Nenhum evento registrado')).toBeTruthy();
  });

  it('erro mostra o alerta com nova tentativa', async () => {
    mock(json({ codigo: 'erro_interno' }, 500));
    setup();
    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it('sem violações axe', async () => {
    mock(json({ items: [ev('1', 'evolucao.retificada')], proximo_cursor: 'c' }));
    const { container } = setup('/app/auditoria?paciente=p1');
    await screen.findByText('Evolução retificada');
    expect((await axe(container)).violations).toEqual([]);
  });
});
