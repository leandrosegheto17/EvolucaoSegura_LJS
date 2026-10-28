import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rotas } from '../rotas.tsx';

// T153 / CONTA-03, CONTA-04: telas públicas dos links dos e-mails da exclusão.
// - /confirmar-exclusao?token=: só envia o token para POST /api/conta/excluir/confirmar quando a
//   pessoa clica (o link é destrutivo; leitor de e-mail que abre links não confirma nada); 200
//   mostra a data da purga; 400 link_invalido, 503 cobranca_indisponivel e falha inesperada têm
//   mensagem própria.
// - /desistir-exclusao?token=: idem com POST /api/conta/desistir; 200 leva a entrar.
// - Nas duas, o token sai da barra de endereço e, sem token, o aviso de link inválido aparece sem
//   chamar a API.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Resposta = { status: number; corpo?: unknown };
function simularFetch(...respostas: Resposta[]) {
  const fila = [...respostas];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    void [url, init];
    const r = fila.shift() ?? { status: 500 };
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const problema = (status: number, codigo: string) => ({
  tipo: 'about:blank',
  titulo: 'x',
  status,
  codigo,
});

function abrir(url: string, { estrito = false } = {}) {
  const roteador = createMemoryRouter(rotas, { initialEntries: [url] });
  const arvore = <RouterProvider router={roteador} />;
  render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore);
  return roteador;
}

describe('/confirmar-exclusao (CONTA-03)', () => {
  const confirmar = async () =>
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar a exclusão' }));

  it('não chama a API ao abrir o link; só no clique, uma vez, com o token', async () => {
    const f = simularFetch({
      status: 200,
      corpo: { status: 'bloqueada', purga_em: '2026-11-27T15:30:00.000Z' },
    });
    abrir('/confirmar-exclusao?token=abc_DEF-123', { estrito: true });

    await screen.findByRole('button', { name: 'Confirmar a exclusão' });
    expect(f).not.toHaveBeenCalled();

    await confirmar();

    expect((await screen.findByRole('status')).textContent).toMatch(/27\/11\/2026/);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('/api/conta/excluir/confirmar');
    expect(f.mock.calls[0]![1]!.method).toBe('POST');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ token: 'abc_DEF-123' });
    expect(screen.queryByRole('button', { name: 'Confirmar a exclusão' })).toBeNull();
  });

  it('a data da purga sai no fuso de São Paulo', async () => {
    simularFetch({
      status: 200,
      corpo: { status: 'bloqueada', purga_em: '2026-11-28T01:00:00.000Z' },
    });
    abrir('/confirmar-exclusao?token=abc');
    await confirmar();
    expect((await screen.findByRole('status')).textContent).toMatch(/27\/11\/2026/);
  });

  it('tira o token da barra de endereço', async () => {
    simularFetch();
    const roteador = abrir('/confirmar-exclusao?token=abc');
    await screen.findByRole('button', { name: 'Confirmar a exclusão' });
    expect(roteador.state.location.search).toBe('');
  });

  it('link inválido (400 link_invalido) mostra mensagem clara', async () => {
    simularFetch({ status: 400, corpo: problema(400, 'link_invalido') });
    abrir('/confirmar-exclusao?token=vencido');
    await confirmar();
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /inválido, expirou ou já foi usado/i,
    );
  });

  it('cobrança indisponível (503) diz que nada mudou e deixa tentar de novo', async () => {
    const f = simularFetch(
      { status: 503, corpo: problema(503, 'cobranca_indisponivel') },
      { status: 200, corpo: { status: 'bloqueada', purga_em: '2026-11-27T15:30:00.000Z' } },
    );
    abrir('/confirmar-exclusao?token=abc');
    await confirmar();
    expect((await screen.findByRole('alert')).textContent).toMatch(/nada foi alterado/i);

    await confirmar();
    expect((await screen.findByRole('status')).textContent).toMatch(/27\/11\/2026/);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falha inesperada não diz que o link é inválido', async () => {
    simularFetch({ status: 500, corpo: problema(500, 'erro_interno') });
    abrir('/confirmar-exclusao?token=abc');
    await confirmar();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).not.toMatch(/inválido/i);
    expect(alerta.textContent).toMatch(/tente novamente/i);
  });

  it('sem token na URL mostra o aviso de link inválido, sem botão e sem chamar a API', async () => {
    const f = simularFetch();
    abrir('/confirmar-exclusao');
    expect((await screen.findByRole('alert')).textContent).toMatch(/inválido/i);
    expect(screen.queryByRole('button', { name: 'Confirmar a exclusão' })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('/desistir-exclusao (CONTA-04)', () => {
  const desistir = async () =>
    fireEvent.click(await screen.findByRole('button', { name: 'Desistir da exclusão' }));

  it('não chama a API ao abrir o link; no clique envia o token e leva a entrar', async () => {
    const f = simularFetch({ status: 200, corpo: { status: 'desbloqueada' } });
    abrir('/desistir-exclusao?token=xyz_789', { estrito: true });

    await screen.findByRole('button', { name: 'Desistir da exclusão' });
    expect(f).not.toHaveBeenCalled();

    await desistir();

    expect((await screen.findByRole('status')).textContent).toMatch(/desbloqueada/i);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('/api/conta/desistir');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ token: 'xyz_789' });
    expect(screen.getByRole('link', { name: /entrar/i }).getAttribute('href')).toBe('/entrar');
  });

  it('tira o token da barra de endereço', async () => {
    simularFetch();
    const roteador = abrir('/desistir-exclusao?token=abc');
    await screen.findByRole('button', { name: 'Desistir da exclusão' });
    expect(roteador.state.location.search).toBe('');
  });

  it('link inválido (400 link_invalido, inclusive depois da purga) mostra mensagem clara', async () => {
    simularFetch({ status: 400, corpo: problema(400, 'link_invalido') });
    abrir('/desistir-exclusao?token=vencido');
    await desistir();
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /inválido, expirou ou já foi usado/i,
    );
  });

  it('falha inesperada não diz que o link é inválido', async () => {
    simularFetch({ status: 500, corpo: problema(500, 'erro_interno') });
    abrir('/desistir-exclusao?token=abc');
    await desistir();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).not.toMatch(/inválido/i);
  });

  it('sem token na URL mostra o aviso de link inválido, sem chamar a API', async () => {
    const f = simularFetch();
    abrir('/desistir-exclusao');
    expect((await screen.findByRole('alert')).textContent).toMatch(/inválido/i);
    expect(f).not.toHaveBeenCalled();
  });
});
