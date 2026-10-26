import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_PERFIL, initialsOf, useProfileName } from './api.ts';

// T65 / PUB-02: nome e iniciais do menu da conta, do perfil (GET /api/perfil). Casos de
// features/profile/profileQuery.spec.tsx do legado, sem o fim de semana (fica para a agenda).

afterEach(() => vi.unstubAllGlobals());

describe('initialsOf', () => {
  it('nome composto: primeira e última', () =>
    expect(initialsOf('Maria da Silva Souza')).toBe('MS'));
  it('acentos e minúsculas', () => expect(initialsOf('álvaro  índio')).toBe('ÁÍ'));
  it('nome único = 1 letra', () => expect(initialsOf('Ana')).toBe('A'));
  it('vazio/indefinido', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
    expect(initialsOf(undefined)).toBe('');
  });
});

function setup(status: number, body: unknown) {
  const f = vi.fn(async (url: string) => {
    void url;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', f);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { f, qc, wrapper };
}

describe('useProfileName', () => {
  it('devolve nome, primeiro nome e iniciais a partir de GET /api/perfil', async () => {
    const { f, wrapper } = setup(200, { nome: 'Maria Souza', contato: null, endereco: null });
    const { result } = renderHook(() => useProfileName(), { wrapper });
    expect(result.current.nome).toBeUndefined();
    await waitFor(() => expect(result.current.nome).toBe('Maria Souza'));
    expect(result.current.primeiroNome).toBe('Maria');
    expect(result.current.iniciais).toBe('MS');
    expect(f.mock.calls[0]![0]).toBe('/api/perfil');
  });

  it('perfil ainda não salvo (404) => nome indefinido sem lançar', async () => {
    const { qc, wrapper } = setup(404, { codigo: 'nao_encontrado' });
    const { result } = renderHook(() => useProfileName(), { wrapper });
    await waitFor(() => expect(qc.getQueryState(CHAVE_PERFIL)?.status).toBe('error'));
    expect(result.current.nome).toBeUndefined();
    expect(result.current.iniciais).toBe('');
  });
});
