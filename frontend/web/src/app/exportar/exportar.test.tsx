import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { definirCsrf } from '../../lib/api.ts';
import { ExportarPage } from './exportar.tsx';

// T175 / EXP-03: tela /app/exportar. Inicia a exportação completa, mostra o progresso, baixa o zip
// e trata 413 e 429 sem perder o estado da tela.
const ID = '0a1b2c3d-4e5f-6789-abcd-ef0123456789';
const json = (b: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), {
    status,
    headers: {
      'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
      ...extra,
    },
  });
const prontuario = {
  paciente: { id: ID, nome: 'Ana' },
  periodo: { de: null, ate: null },
  profissional: null,
  anamnese: null,
  evolucoes: [],
};
const roteiro = (f: (url: string) => Response | Promise<Response>) => {
  const fn = vi.fn(async (url: string) => f(url));
  vi.stubGlobal('fetch', fn);
  return fn;
};
const normal = (url: string) => {
  if (url === '/api/exportacao')
    return json({ tabela: 'perfil', proximo_cursor: 'c1', linhas: [] });
  if (url === '/api/exportacao?cursor=c1')
    return json({ tabela: 'paciente', proximo_cursor: null, linhas: [{ id: ID, nome: 'Ana' }] });
  if (url === `/api/pacientes/${ID}/prontuario`) return json(prontuario);
  return json({}, 404);
};

let baixados: { nome: string; blob: Blob }[];
beforeEach(() => {
  baixados = [];
  URL.createObjectURL = vi.fn((b: Blob) => {
    baixados.push({ nome: '', blob: b });
    return 'blob:x';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    baixados[baixados.length - 1]!.nome = this.download;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  definirCsrf(null);
});

describe('Exportar tudo (EXP-03)', () => {
  it('inicia, mostra o progresso e baixa o zip com dados.json e o PDF do paciente', async () => {
    const f = roteiro(normal);
    render(<ExportarPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }));
    await waitFor(() => expect(baixados).toHaveLength(1), { timeout: 20_000 });
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/exportacao',
      '/api/exportacao?cursor=c1',
      `/api/pacientes/${ID}/prontuario`,
    ]);
    expect(baixados[0]!.nome).toBe('evolucao-segura-exportacao.zip');
    const zip = unzipSync(new Uint8Array(await baixados[0]!.blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['dados.json', 'prontuarios/prontuario-0a1b2c3d.pdf']);
    expect(JSON.parse(strFromU8(zip['dados.json']!)).paciente).toEqual([{ id: ID, nome: 'Ana' }]);
    expect(await screen.findByText('Exportação concluída. O arquivo foi baixado.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar meus dados' })).toBeTruthy();
  }, 30_000);

  it('mostra o progresso enquanto a exportação anda e desabilita o botão', async () => {
    let liberar!: () => void;
    roteiro((url) =>
      url === '/api/exportacao'
        ? new Promise<Response>((r) => {
            liberar = () => r(json({ tabela: 'perfil', proximo_cursor: null, linhas: [] }));
          })
        : normal(url),
    );
    render(<ExportarPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }));
    expect(await screen.findByText('Baixando os dados: página 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportando…' }).hasAttribute('disabled')).toBe(true);
    liberar();
    await waitFor(() => expect(baixados).toHaveLength(1));
  });

  it('429 explica o limite e deixa tentar de novo', async () => {
    roteiro(() =>
      json({ codigo: 'limite_exportacao', titulo: 'Muitas exportações', status: 429 }, 429, {
        'Retry-After': '30',
      }),
    );
    render(<ExportarPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Você iniciou exportações demais em pouco tempo');
    expect(alerta.textContent).toContain('30 segundos');
    expect(baixados).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Exportar meus dados' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('413 explica que o volume é grande demais e deixa tentar de novo', async () => {
    roteiro((url) =>
      url === '/api/exportacao'
        ? json({ tabela: 'perfil', proximo_cursor: 'c1', linhas: [] })
        : json({ codigo: 'erro', status: 413 }, 413),
    );
    render(<ExportarPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Os dados são grandes demais');
    expect(baixados).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Exportar meus dados' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('outro erro mostra mensagem genérica', async () => {
    roteiro(() => json({ codigo: 'erro', status: 500 }, 500));
    render(<ExportarPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível exportar');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<ExportarPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
