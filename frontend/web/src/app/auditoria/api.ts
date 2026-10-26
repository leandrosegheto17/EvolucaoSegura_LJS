import type { FiltroAuditoria, PaginaAuditoria } from '@es/contrato/auditoria';
import { api } from '../../lib/api.ts';

// AUD-03: leitura da trilha, portada de audit/auditApi.ts do legado para GET /api/auditoria.
// Sem `pacienteId` é a trilha da conta; com ele, o histórico do paciente. O filtro vai ao servidor.

export const listarAuditoria = (
  pacienteId: string | null,
  filtro: FiltroAuditoria,
  cursor: string | null,
  sinal?: AbortSignal,
) => {
  const p = new URLSearchParams();
  if (pacienteId) p.set('paciente_id', pacienteId);
  if (filtro !== 'todos') p.set('filtro', filtro);
  if (cursor) p.set('cursor', cursor);
  const consulta = p.toString();
  return api.requisitar<PaginaAuditoria>(
    consulta ? `/auditoria?${consulta}` : '/auditoria',
    sinal !== undefined ? { sinal } : {},
  );
};
