import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definirCsrf, lerCsrf } from '../lib/api.ts';
import { rotas } from '../rotas.tsx';

// T58 / AUTH-01, AUTH-04, AUTH-06: telas /entrar e do código 2FA.
// - senha certa (202 2fa_required) leva ao passo do código; o código certo (200 com csrf_token)
//   guarda o token e entra no app (/app);
// - o reenvio do código fica bloqueado por 60 s, com contagem, e recomeça a contagem a cada pedido;
// - 503 (mail_unavailable) mostra "Não foi possível enviar o código agora".

beforeEach(() => definirCsrf(null));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Resposta = { status: number; corpo?: unknown; headers?: Record<string, string> };
function simularFetch(...respostas: Resposta[]) {
  const fila = [...respostas];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    void [url, init];
    const r = fila.shift() ?? { status: 500 };
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), {
      status: r.status,
      headers: { 'content-type': 'application/json', ...r.headers },
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
const OK_ENTRAR: Resposta = { status: 202, corpo: { status: '2fa_required' } };
const OK_VERIFICAR: Resposta = {
  status: 200,
  corpo: { usuario: { id: 'u1' }, csrf_token: 'token-csrf-da-sessao' },
};

function abrir() {
  const roteador = createMemoryRouter(rotas, { initialEntries: ['/entrar'] });
  render(<RouterProvider router={roteador} />);
  return roteador;
}

const corpoDa = (f: ReturnType<typeof simularFetch>, i: number) =>
  JSON.parse(String(f.mock.calls[i]![1]!.body)) as unknown;

async function passarDaSenha() {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.com.br' } });
  fireEvent.change(screen.getByLabelText('Senha'), {
    target: { value: 'cavalo-bateria-grampo-7' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  const campo = await screen.findByLabelText('Código');
  // A resposta chega fora do act: os efeitos (o setInterval da contagem) rodam depois do render.
  // Esperar por eles evita adiantar o relógio antes de a contagem existir.
  await act(async () => {});
  return campo;
}

const botaoReenviar = () => screen.getByRole('button', { name: /reenviar/i }) as HTMLButtonElement;

describe('fluxo senha, código, entrada no app (AUTH-01, AUTH-04)', () => {
  it('senha certa pede o código; código certo guarda o CSRF e abre /app', async () => {
    const f = simularFetch(OK_ENTRAR, OK_VERIFICAR);
    const roteador = abrir();

    await passarDaSenha();
    expect(f.mock.calls[0]![0]).toBe('/api/auth/entrar');
    expect(corpoDa(f, 0)).toEqual({
      email: 'ana@exemplo.com.br',
      senha: 'cavalo-bateria-grampo-7',
    });
    expect(screen.getByText(/ana@exemplo\.com\.br/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar código' }));

    await vi.waitFor(() => expect(roteador.state.location.pathname).toBe('/app'));
    expect(f.mock.calls[1]![0]).toBe('/api/auth/2fa/verificar');
    expect(corpoDa(f, 1)).toEqual({ email: 'ana@exemplo.com.br', codigo: '123456' });
    expect(lerCsrf()).toBe('token-csrf-da-sessao');
    expect(await screen.findByRole('heading', { name: 'Evolução Segura' })).toBeTruthy();
  });

  it('as chamadas de entrar e do código são públicas (sem x-csrf-token)', async () => {
    const f = simularFetch(OK_ENTRAR, OK_VERIFICAR);
    abrir();
    await passarDaSenha();
    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar código' }));
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));

    for (const chamada of f.mock.calls)
      expect(new Headers(chamada[1]!.headers).has('x-csrf-token')).toBe(false);
  });

  it('a senha não fica na tela depois do passo 1', async () => {
    simularFetch(OK_ENTRAR);
    abrir();
    await passarDaSenha();
    expect(screen.queryByLabelText('Senha')).toBeNull();
  });

  it('senha errada (401) mostra mensagem única, sem dizer se o e-mail existe', async () => {
    simularFetch({ status: 401, corpo: problema(401, 'credenciais_invalidas') });
    abrir();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'errada-errada-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/e-mail ou senha incorretos/i);
    expect(screen.queryByLabelText('Código')).toBeNull();
  });

  it('bloqueio (429) mostra quanto tempo esperar, pelo Retry-After', async () => {
    simularFetch({
      status: 429,
      corpo: problema(429, 'muitas_tentativas'),
      headers: { 'Retry-After': '840' },
    });
    abrir();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'qualquer-senha-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/14 minutos/);
  });

  it('código errado (401) não sai da tela do código e não vai para a sessão expirada', async () => {
    simularFetch(OK_ENTRAR, { status: 401, corpo: problema(401, 'credenciais_invalidas') });
    const roteador = abrir();
    await passarDaSenha();

    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar código' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/código incorreto ou vencido/i);
    expect(roteador.state.location.pathname).toBe('/entrar');
    expect(screen.getByLabelText('Código')).toBeTruthy();
  });

  it('código precisa ter 6 dígitos antes de enviar', async () => {
    const f = simularFetch(OK_ENTRAR);
    abrir();
    await passarDaSenha();

    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '12a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar código' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/6 dígitos/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('503 mail_unavailable (AUTH-08)', () => {
  it('mostra "Não foi possível enviar o código agora" e fica no passo da senha', async () => {
    simularFetch({ status: 503, corpo: problema(503, 'mail_unavailable') });
    abrir();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'cavalo-bateria-grampo-7' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível enviar o código agora',
    );
    expect(screen.queryByLabelText('Código')).toBeNull();
  });
});

describe('reenvio com contagem de 60 s (AUTH-06)', () => {
  beforeEach(() => {
    // Só o relógio e o setInterval da contagem são simulados; o resto do teste usa o tempo real.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  });

  it('o reenvio fica bloqueado nos primeiros 60 s, mostrando a contagem', async () => {
    simularFetch(OK_ENTRAR);
    abrir();
    await passarDaSenha();

    expect(botaoReenviar().disabled).toBe(true);
    expect(botaoReenviar().textContent).toMatch(/60 s/);

    act(() => vi.advanceTimersByTime(59_000));
    expect(botaoReenviar().disabled).toBe(true);
    expect(botaoReenviar().textContent).toMatch(/1 s/);

    act(() => vi.advanceTimersByTime(1_000));
    expect(botaoReenviar().disabled).toBe(false);
    expect(botaoReenviar().textContent).not.toMatch(/\d+ s/);
  });

  it('reenviar chama POST /api/auth/2fa/reenviar com o e-mail e recomeça a contagem', async () => {
    const f = simularFetch(OK_ENTRAR, { status: 202, corpo: { status: 'aceito' } });
    abrir();
    await passarDaSenha();
    act(() => vi.advanceTimersByTime(60_000));

    fireEvent.click(botaoReenviar());

    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(f.mock.calls[1]![0]).toBe('/api/auth/2fa/reenviar');
    expect(corpoDa(f, 1)).toEqual({ email: 'ana@exemplo.com.br' });
    // Depois da resposta (aviso na tela), o botão volta à contagem de 60 s.
    expect((await screen.findByRole('status')).textContent).toMatch(/novo código/i);
    await act(async () => {});
    expect(botaoReenviar().disabled).toBe(true);
    expect(botaoReenviar().textContent).toMatch(/60 s/);
  });

  it('clicar durante a contagem não chama a API', async () => {
    const f = simularFetch(OK_ENTRAR);
    abrir();
    await passarDaSenha();

    fireEvent.click(botaoReenviar());

    expect(f).toHaveBeenCalledTimes(1);
  });
});
