import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rotas } from '../rotas.tsx';

// T59 / AUTH-13, AUTH-14, AUTH-15: telas /recuperar e /redefinir.
// - o pedido (POST /api/auth/recuperar, 202 vazio) mostra sempre a mesma mensagem, exista a
//   conta ou não;
// - a redefinição (POST /api/auth/recuperar/confirmar) trata o 400 link_invalido (pede um link
//   novo) e o 422 com o motivo da política de senha; o 204 leva a entrar.

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
    const vazio = r.status === 202 || r.status === 204 || r.corpo === undefined;
    return new Response(vazio ? null : JSON.stringify(r.corpo), {
      status: r.status,
      headers: vazio ? {} : { 'content-type': 'application/problem+json' },
    });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const problema = (status: number, codigo: string, extra: Record<string, unknown> = {}) => ({
  tipo: 'about:blank',
  titulo: 'x',
  status,
  codigo,
  ...extra,
});

function abrir(url: string) {
  const roteador = createMemoryRouter(rotas, { initialEntries: [url] });
  render(<RouterProvider router={roteador} />);
  return roteador;
}

async function pedirLink(email: string) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
  return (await screen.findByRole('status')).textContent;
}

async function redefinir(senha: string) {
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: senha } });
  fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }));
}

describe('/recuperar (AUTH-13)', () => {
  it('envia o e-mail para POST /api/auth/recuperar como rota pública', async () => {
    const f = simularFetch({ status: 202 });
    abrir('/recuperar');

    await pedirLink('ana@exemplo.com.br');

    expect(f.mock.calls[0]![0]).toBe('/api/auth/recuperar');
    expect(f.mock.calls[0]![1]!.method).toBe('POST');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ email: 'ana@exemplo.com.br' });
    expect(new Headers(f.mock.calls[0]![1]!.headers).has('x-csrf-token')).toBe(false);
  });

  it('mostra sempre a mesma mensagem, para qualquer e-mail', async () => {
    simularFetch({ status: 202 }, { status: 202 });
    abrir('/recuperar');
    const primeira = await pedirLink('tem-conta@exemplo.com.br');
    cleanup();
    abrir('/recuperar');
    const segunda = await pedirLink('nao-tem-conta@exemplo.com.br');

    expect(primeira).toBe(segunda);
    expect(primeira).toMatch(/se houver uma conta com esse e-mail/i);
    expect(primeira).toMatch(/30 minutos/);
    expect(primeira).not.toContain('tem-conta@exemplo.com.br');
  });

  it('e-mail recusado pelo contrato (422 validacao) marca o campo', async () => {
    simularFetch({ status: 422, corpo: problema(422, 'validacao', { campos: ['email'] }) });
    abrir('/recuperar');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));

    const campo = screen.getByLabelText('E-mail');
    await vi.waitFor(() => expect(campo.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('429 pede para esperar', async () => {
    simularFetch({ status: 429, corpo: problema(429, 'muitas_tentativas') });
    abrir('/recuperar');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.com.br' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/aguarde/i);
  });
});

describe('/redefinir (AUTH-14, AUTH-15)', () => {
  it('envia o token do link e a senha nova; 204 leva a entrar', async () => {
    const f = simularFetch({ status: 204 });
    abrir('/redefinir?token=tok_ABC-123');

    await redefinir('girassol-lanterna-ponte-9');

    expect((await screen.findByRole('status')).textContent).toMatch(/senha redefinida/i);
    expect(f.mock.calls[0]![0]).toBe('/api/auth/recuperar/confirmar');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({
      token: 'tok_ABC-123',
      nova_senha: 'girassol-lanterna-ponte-9',
    });
    expect(screen.getByRole('link', { name: /entrar/i }).getAttribute('href')).toBe('/entrar');
  });

  it('tira o token da barra de endereço e continua usando-o', async () => {
    const f = simularFetch({ status: 204 });
    const roteador = abrir('/redefinir?token=abc');

    expect(roteador.state.location.search).toBe('');
    await redefinir('girassol-lanterna-ponte-9');
    await screen.findByRole('status');
    expect(String(f.mock.calls[0]![1]!.body)).toContain('"token":"abc"');
  });

  it('400 link_invalido mostra a mensagem do link e oferece pedir um novo', async () => {
    simularFetch({ status: 400, corpo: problema(400, 'link_invalido') });
    abrir('/redefinir?token=vencido');

    await redefinir('girassol-lanterna-ponte-9');

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /inválido, expirou ou já foi usado/i,
    );
    expect(screen.getByRole('link', { name: 'Pedir novo link' }).getAttribute('href')).toBe(
      '/recuperar',
    );
    expect(screen.queryByLabelText('Nova senha')).toBeNull();
  });

  it.each([
    ['curta', /pelo menos 12 caracteres/],
    ['longa', /no máximo 128 caracteres/],
    ['comum', /comum ou fácil de adivinhar/],
  ])(
    '422 com motivo %s mostra a explicação no campo e deixa tentar de novo',
    async (motivo, texto) => {
      simularFetch({ status: 422, corpo: problema(422, 'senha_fora_da_politica', { motivo }) });
      abrir('/redefinir?token=abc');

      await redefinir('fraca');

      const campo = screen.getByLabelText('Nova senha');
      await vi.waitFor(() => expect(campo.getAttribute('aria-invalid')).toBe('true'));
      expect(document.getElementById(campo.getAttribute('aria-describedby')!)!.textContent).toMatch(
        texto,
      );
      expect(screen.getByRole('button', { name: 'Redefinir senha' })).toBeTruthy();
    },
  );

  it('sem token na URL mostra o aviso de link inválido, sem formulário e sem chamar a API', () => {
    const f = simularFetch();
    abrir('/redefinir');

    expect(screen.getByRole('alert').textContent).toMatch(/inválido/i);
    expect(screen.queryByLabelText('Nova senha')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('falha inesperada mostra mensagem genérica e mantém o formulário', async () => {
    simularFetch({ status: 500, corpo: problema(500, 'erro_interno') });
    abrir('/redefinir?token=abc');

    await redefinir('girassol-lanterna-ponte-9');

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/não foi possível/i);
    expect(alerta.textContent).not.toMatch(/inválido/i);
    expect(screen.getByLabelText('Nova senha')).toBeTruthy();
  });
});
