import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { ExcluirContaPage } from './excluir.tsx';

// T153 / CONTA-01, CONTA-02: tela /app/conta/excluir. O fluxo tem os três requisitos do pedido:
// a exportação completa (feita nesta tela), a declaração de guarda do prontuário e a senha. O
// botão de pedir só fica ativo com os três. O pedido vai a POST /api/conta/excluir; o 202 avisa do
// link de confirmação no e-mail; o 422 requisitos_exclusao mostra cada requisito que o servidor
// recusou; 429 e falha inesperada têm mensagem própria.

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problema = (status: number, codigo: string, extra: Record<string, unknown> = {}) => ({
  tipo: 'about:blank',
  titulo: 'x',
  status,
  codigo,
  ...extra,
});

type Rota = (init?: RequestInit) => Response | Promise<Response>;

// Exportação de uma página só, sem pacientes (sem PDF): a tela baixa o zip e libera o requisito.
const EXPORTACAO: Record<string, Rota> = {
  'GET /api/exportacao': () => json({ tabela: 'paciente', proximo_cursor: null, linhas: [] }),
};

function roteiro(rotas: Record<string, Rota>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${url}`;
    const rota = rotas[chave];
    return rota ? rota(init) : json(problema(404, 'nao_encontrado'), 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const pedidos = (f: ReturnType<typeof roteiro>) =>
  f.mock.calls.filter((c) => c[0] === '/api/conta/excluir');

beforeEach(() => {
  definirCsrf('t');
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  definirCsrf(null);
});

const abrir = () =>
  render(
    <MemoryRouter>
      <ExcluirContaPage />
    </MemoryRouter>,
  );

const botaoPedir = () => screen.getByRole('button', { name: 'Pedir a exclusão' });
const exportar = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }));
  await screen.findByText('Exportação concluída. O arquivo foi baixado.', {}, { timeout: 20_000 });
};
const declarar = () => fireEvent.click(screen.getByRole('checkbox'));
const digitarSenha = (senha = 'cavalo-bateria-grampo-7') =>
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } });

async function preencherTudo() {
  await exportar();
  declarar();
  digitarSenha();
}

describe('botão só com os três requisitos (CONTA-01)', () => {
  it('começa desativado', () => {
    roteiro(EXPORTACAO);
    abrir();
    expect((botaoPedir() as HTMLButtonElement).disabled).toBe(true);
  });

  it('sem a exportação, com declaração e senha: desativado', () => {
    roteiro(EXPORTACAO);
    abrir();
    declarar();
    digitarSenha();
    expect((botaoPedir() as HTMLButtonElement).disabled).toBe(true);
  });

  it('sem a declaração, com exportação e senha: desativado', async () => {
    roteiro(EXPORTACAO);
    abrir();
    await exportar();
    digitarSenha();
    expect((botaoPedir() as HTMLButtonElement).disabled).toBe(true);
  }, 30_000);

  it('sem a senha, com exportação e declaração: desativado', async () => {
    roteiro(EXPORTACAO);
    abrir();
    await exportar();
    declarar();
    expect((botaoPedir() as HTMLButtonElement).disabled).toBe(true);
  }, 30_000);

  it('exportação que falhou não conta: desativado', async () => {
    roteiro({ 'GET /api/exportacao': () => json(problema(500, 'erro_interno'), 500) });
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }));
    await screen.findByText(/não foi possível exportar/i);
    declarar();
    digitarSenha();
    expect((botaoPedir() as HTMLButtonElement).disabled).toBe(true);
  });

  it('com os três: ativo', async () => {
    roteiro(EXPORTACAO);
    abrir();
    await preencherTudo();
    expect((botaoPedir() as HTMLButtonElement).disabled).toBe(false);
  }, 30_000);

  it('desmarcar a declaração desativa de novo', async () => {
    roteiro(EXPORTACAO);
    abrir();
    await preencherTudo();
    declarar();
    expect((botaoPedir() as HTMLButtonElement).disabled).toBe(true);
  }, 30_000);
});

describe('pedido e mensagens do servidor (CONTA-01, CONTA-02)', () => {
  it('envia senha e declaração e avisa do link de confirmação no e-mail', async () => {
    const f = roteiro({
      ...EXPORTACAO,
      'POST /api/conta/excluir': () => json({ status: 'confirmacao_enviada' }, 202),
    });
    abrir();
    await preencherTudo();
    fireEvent.click(botaoPedir());

    expect((await screen.findByText(/link de confirmação/i)).textContent).toMatch(/30 minutos/);
    expect(pedidos(f)).toHaveLength(1);
    expect(JSON.parse(String(pedidos(f)[0]![1]!.body))).toEqual({
      senha: 'cavalo-bateria-grampo-7',
      declaracao_guarda: true,
    });
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
  }, 30_000);

  it.each([
    [['senha'], /senha está incorreta/i],
    [['exportacao'], /exportação completa nas últimas 24 horas/i],
    [['declaracao_guarda'], /declaração de guarda/i],
  ])(
    '422 requisitos_exclusao %j mostra a mensagem do requisito',
    async (requisitos, texto) => {
      roteiro({
        ...EXPORTACAO,
        'POST /api/conta/excluir': () =>
          json(problema(422, 'requisitos_exclusao', { requisitos }), 422),
      });
      abrir();
      await preencherTudo();
      fireEvent.click(botaoPedir());
      expect((await screen.findByRole('alert')).textContent).toMatch(texto);
    },
    30_000,
  );

  it('422 com mais de um requisito mostra todos', async () => {
    roteiro({
      ...EXPORTACAO,
      'POST /api/conta/excluir': () =>
        json(problema(422, 'requisitos_exclusao', { requisitos: ['exportacao', 'senha'] }), 422),
    });
    abrir();
    await preencherTudo();
    fireEvent.click(botaoPedir());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/exportação completa/i);
    expect(alerta.textContent).toMatch(/senha está incorreta/i);
  }, 30_000);

  it('429 pede para aguardar', async () => {
    roteiro({
      ...EXPORTACAO,
      'POST /api/conta/excluir': () => json(problema(429, 'muitas_requisicoes'), 429),
    });
    abrir();
    await preencherTudo();
    fireEvent.click(botaoPedir());
    expect((await screen.findByRole('alert')).textContent).toMatch(/aguarde/i);
  }, 30_000);

  it('falha inesperada: mensagem genérica e o botão volta', async () => {
    roteiro({
      ...EXPORTACAO,
      'POST /api/conta/excluir': () => json(problema(500, 'erro_interno'), 500),
    });
    abrir();
    await preencherTudo();
    fireEvent.click(botaoPedir());
    expect((await screen.findByRole('alert')).textContent).toMatch(/tente novamente/i);
    await waitFor(() => expect((botaoPedir() as HTMLButtonElement).disabled).toBe(false));
  }, 30_000);

  it('não tem violações de acessibilidade', async () => {
    roteiro(EXPORTACAO);
    const { container } = abrir();
    expect((await axe(container)).violations).toEqual([]);
  });
});
