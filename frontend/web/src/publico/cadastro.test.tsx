import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rotas } from '../rotas.tsx';

// T57 / CAD-01, CAD-05: telas /cadastro e /confirmar.
// - o cadastro envia nome, e-mail, senha e o aceite dos termos para POST /api/cadastro;
// - sem o aceite, não envia;
// - o 422 da política de senha mostra o motivo (curta, longa, comum);
// - /confirmar envia o token do link; link inválido (400 link_invalido) mostra mensagem clara.

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

const problema = (status: number, codigo: string, extra: Record<string, unknown> = {}) => ({
  tipo: 'about:blank',
  titulo: 'x',
  status,
  codigo,
  ...extra,
});

function abrir(url: string, { estrito = false } = {}) {
  const roteador = createMemoryRouter(rotas, { initialEntries: [url] });
  const arvore = <RouterProvider router={roteador} />;
  render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore);
  return roteador;
}

function preencher(dados: { nome?: string; email?: string; senha?: string; aceite?: boolean }) {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: dados.nome ?? 'Ana Souza' } });
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: dados.email ?? 'ana@exemplo.com.br' },
  });
  fireEvent.change(screen.getByLabelText('Senha'), {
    target: { value: dados.senha ?? 'cavalo-bateria-grampo-7' },
  });
  if (dados.aceite ?? true) fireEvent.click(screen.getByRole('checkbox'));
}

const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

describe('/cadastro (CAD-01)', () => {
  it('envia nome, e-mail, senha e aceite para POST /api/cadastro', async () => {
    const f = simularFetch({ status: 202, corpo: { status: 'aceito' } });
    abrir('/cadastro');

    preencher({});
    enviar();

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('/api/cadastro');
    expect(f.mock.calls[0]![1]!.method).toBe('POST');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({
      nome: 'Ana Souza',
      email: 'ana@exemplo.com.br',
      senha: 'cavalo-bateria-grampo-7',
      aceite_termos: true,
    });
  });

  it('depois do 202 mostra que o link de confirmação foi enviado, sem dizer se a conta já existia', async () => {
    simularFetch({ status: 202, corpo: { status: 'aceito' } });
    abrir('/cadastro');

    preencher({});
    enviar();

    const aviso = await screen.findByRole('status');
    expect(aviso.textContent).toMatch(/link de confirmação/i);
    expect(aviso.textContent).toContain('ana@exemplo.com.br');
    expect(aviso.textContent).not.toMatch(/já (tem|existe)/i);
  });

  it('o aceite tem links para os termos de uso e a política de privacidade', () => {
    abrir('/cadastro');
    expect(screen.getByRole('link', { name: /termos de uso/i }).getAttribute('href')).toBe(
      '/termos',
    );
    expect(screen.getByRole('link', { name: /privacidade/i }).getAttribute('href')).toBe(
      '/privacidade',
    );
  });

  it('sem o aceite dos termos não envia e explica o motivo', async () => {
    const f = simularFetch();
    abrir('/cadastro');

    preencher({ aceite: false });
    enviar();

    expect((await screen.findByRole('alert')).textContent).toMatch(/aceite os termos/i);
    expect(f).not.toHaveBeenCalled();
  });

  it('não guarda a senha depois do envio', async () => {
    simularFetch({ status: 202, corpo: { status: 'aceito' } });
    abrir('/cadastro');

    preencher({});
    enviar();
    await screen.findByRole('status');

    expect(document.body.textContent).not.toContain('cavalo-bateria-grampo-7');
    expect(screen.queryByLabelText('Senha')).toBeNull();
  });
});

describe('motivo da política de senha (AUTH-11)', () => {
  it.each([
    ['curta', /pelo menos 12 caracteres/],
    ['longa', /no máximo 128 caracteres/],
    ['comum', /comum ou fácil de adivinhar/],
  ])('422 com motivo %s mostra a explicação no campo da senha', async (motivo, texto) => {
    simularFetch({ status: 422, corpo: problema(422, 'senha_fora_da_politica', { motivo }) });
    abrir('/cadastro');

    preencher({ senha: 'qualquer' });
    enviar();

    const campo = screen.getByLabelText('Senha');
    await vi.waitFor(() => expect(campo.getAttribute('aria-invalid')).toBe('true'));
    const descricao = document.getElementById(campo.getAttribute('aria-describedby')!);
    expect(descricao!.textContent).toMatch(texto);
  });
});

describe('outros erros do contrato', () => {
  it('422 validacao marca o campo recusado', async () => {
    simularFetch({ status: 422, corpo: problema(422, 'validacao', { campos: ['email'] }) });
    abrir('/cadastro');

    preencher({ email: 'ana@' });
    enviar();

    const campo = screen.getByLabelText('E-mail');
    await vi.waitFor(() => expect(campo.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(campo.getAttribute('aria-describedby')!)!.textContent).toMatch(
      /e-mail válido/i,
    );
  });

  it('429 pede para esperar', async () => {
    simularFetch({ status: 429, corpo: problema(429, 'muitas_tentativas') });
    abrir('/cadastro');

    preencher({});
    enviar();

    expect((await screen.findByRole('alert')).textContent).toMatch(/aguarde/i);
  });

  it('erro inesperado mostra mensagem genérica e mantém o formulário', async () => {
    simularFetch({ status: 500, corpo: problema(500, 'erro_interno') });
    abrir('/cadastro');

    preencher({});
    enviar();

    expect((await screen.findByRole('alert')).textContent).toMatch(/não foi possível/i);
    expect(screen.getByLabelText('Nome')).toBeTruthy();
  });
});

describe('/confirmar (CAD-04, CAD-05)', () => {
  it('envia o token do link para POST /api/cadastro/confirmar uma vez só e mostra a conta confirmada', async () => {
    const f = simularFetch({ status: 200, corpo: { status: 'confirmada' } });
    abrir('/confirmar?token=abc_DEF-123', { estrito: true });

    expect((await screen.findByRole('status')).textContent).toMatch(/e-mail confirmado/i);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('/api/cadastro/confirmar');
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ token: 'abc_DEF-123' });
    expect(screen.getByRole('link', { name: /entrar/i }).getAttribute('href')).toBe('/entrar');
  });

  it('tira o token da barra de endereço', async () => {
    simularFetch({ status: 200, corpo: { status: 'confirmada' } });
    const roteador = abrir('/confirmar?token=abc');

    await screen.findByRole('status');
    expect(roteador.state.location.search).toBe('');
  });

  it('link inválido (400 link_invalido) mostra mensagem clara e o caminho para cadastrar de novo', async () => {
    simularFetch({ status: 400, corpo: problema(400, 'link_invalido') });
    abrir('/confirmar?token=vencido');

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/inválido, expirou ou já foi usado/i);
    expect(screen.getByRole('link', { name: /cadastr/i }).getAttribute('href')).toBe('/cadastro');
  });

  it('sem token na URL mostra o mesmo aviso de link inválido, sem chamar a API', async () => {
    const f = simularFetch();
    abrir('/confirmar');

    expect((await screen.findByRole('alert')).textContent).toMatch(/inválido/i);
    expect(f).not.toHaveBeenCalled();
  });

  it('falha inesperada não diz que o link é inválido', async () => {
    simularFetch({ status: 500, corpo: problema(500, 'erro_interno') });
    abrir('/confirmar?token=abc');

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/não foi possível/i);
    expect(alerta.textContent).not.toMatch(/inválido/i);
  });
});
