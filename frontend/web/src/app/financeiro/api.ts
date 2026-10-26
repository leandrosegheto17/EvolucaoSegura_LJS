import type { ListaDebitos, PendenciasPaciente, SituacaoDebito } from '@es/contrato/financeiro';
import { api } from '../../lib/api.ts';

// FIN-07: chamadas da tela de financeiro, portadas de billing/debts/debtsApi.ts do legado, para
// /api/debitos. Valores em centavos inteiros (ADR-007); a tela formata em reais.

export type FiltroDebitos = 'todos' | SituacaoDebito;

const comSinal = (sinal?: AbortSignal) => (sinal !== undefined ? { sinal } : {});

/** GET /api/debitos: `status` ausente = todos. */
export const listarDebitos = (filtro: FiltroDebitos, sinal?: AbortSignal) =>
  api.requisitar<ListaDebitos>(
    filtro === 'todos' ? '/debitos' : `/debitos?status=${filtro}`,
    comSinal(sinal),
  );

/** GET /api/debitos/:pacienteId: sessões pendentes do paciente. */
export const lerPendencias = (pacienteId: string, sinal?: AbortSignal) =>
  api.requisitar<PendenciasPaciente>(`/debitos/${encodeURIComponent(pacienteId)}`, comSinal(sinal));
