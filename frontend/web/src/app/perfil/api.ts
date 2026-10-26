import type { Perfil } from '@es/contrato/perfil';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';

// PERF-02: leitura do perfil no app, portada de features/profile/profileApi.ts e profileQuery.ts
// do legado, para GET /api/perfil. Antes do primeiro salvamento a API responde 404: a consulta
// fica em erro e quem lê o nome recebe indefinido, sem lançar.

// Chave única do GET /api/perfil, compartilhada pelo menu da conta e pela tela de perfil.
export const CHAVE_PERFIL = ['perfil'] as const;

export const lerPerfil = (sinal?: AbortSignal) =>
  api.requisitar<Perfil>('/perfil', sinal !== undefined ? { sinal } : {});

/** Pura: 1a letra do primeiro e do último nome, maiúsculas; nome único = 1 letra; vazio = ''. */
export function initialsOf(nome: string | null | undefined): string {
  const parts = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = Array.from(parts[0]!)[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return (first + last).toLocaleUpperCase('pt-BR');
}

export interface ProfileName {
  nome: string | undefined;
  primeiroNome: string | undefined;
  iniciais: string;
}

/** Nome do perfil via cache compartilhado. Carregando/erro => nome indefinido, sem lançar. */
export function useProfileName(): ProfileName {
  const q = useQuery({ queryKey: CHAVE_PERFIL, queryFn: ({ signal }) => lerPerfil(signal) });
  const nome = q.data?.nome?.trim() || undefined;
  return { nome, primeiroNome: nome?.split(/\s+/)[0], iniciais: initialsOf(nome) };
}
