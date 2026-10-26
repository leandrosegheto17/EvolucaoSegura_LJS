import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { api, definirCsrf } from '../lib/api.ts';

// AUTH-16, PUB-02: "Sair" do menu da conta, portado de features/auth/session/signOut.ts do
// legado. Esquece o token CSRF e o cache do TanStack Query (dados do profissional), avisa o
// servidor (POST /api/auth/sair; falha ignorada, como no legado) e vai para /entrar.
// PREMISSA: o legado ia para /sessao-expirada?motivo=saiu; a tela de sessão expirada daqui só
// fala de inatividade, então quem sai vai direto para /entrar.

export const CAMINHO_APOS_SAIR = '/entrar';

export function useSignOut(): () => void {
  const navegar = useNavigate();
  const clienteQuery = useQueryClient();
  return useCallback(() => {
    void api.requisitar('/auth/sair', { metodo: 'POST' }).catch(() => undefined);
    definirCsrf(null);
    clienteQuery.clear();
    void navegar(CAMINHO_APOS_SAIR, { replace: true });
  }, [clienteQuery, navegar]);
}
