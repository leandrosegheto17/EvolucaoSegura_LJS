import type { RespostaCancelar, RespostaPlano } from '@es/contrato/plano';
import { api } from '../../lib/api.ts';

// PLANO-05, PLANO-11, PLANO-14: chamadas de "Meu plano". Sem equivalente no legado.

export const lerPlano = (sinal?: AbortSignal) =>
  api.requisitar<RespostaPlano>('/plano', sinal !== undefined ? { sinal } : {});

export const assinarPlano = (corpo: { nome: string; cpf_cnpj: string }) =>
  api.requisitar<{ status: 'aguardando_pagamento' }>('/plano/assinar', {
    metodo: 'POST',
    corpo,
  });

export const cancelarPlano = () =>
  api.requisitar<RespostaCancelar>('/plano/cancelar', { metodo: 'POST' });
