import type {
  MudancaStatus,
  PaginaSessoes,
  RespostaSerie,
  SerieCancelamento,
  SerieEntrada,
  Sessao,
  SessaoEntrada,
} from '@es/contrato/agenda';
import { api } from '../../lib/api.ts';

// AGE-01, AGE-03, AGE-04, AGE-07, AGE-13: chamadas das telas da agenda, portadas de
// scheduling/agenda/agendaApi.ts e features/scheduling/new/newSessionApi.ts do legado, para
// /api/sessoes e /api/series.

/** GET /api/sessoes: junta as páginas do cursor keyset (100 por página) do intervalo [de, ate). */
export async function listarSessoes(de: Date, ate: Date, sinal?: AbortSignal): Promise<Sessao[]> {
  const itens: Sessao[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({
      de: de.toISOString(),
      ate: ate.toISOString(),
      limit: '100',
    });
    if (cursor !== null) qs.set('cursor', cursor);
    const pagina: PaginaSessoes = await api.requisitar<PaginaSessoes>(
      `/sessoes?${qs}`,
      sinal !== undefined ? { sinal } : {},
    );
    itens.push(...pagina.items);
    cursor = pagina.proximo_cursor;
  } while (cursor !== null);
  return itens;
}

export const criarSessao = (corpo: SessaoEntrada) =>
  api.requisitar<Sessao>('/sessoes', { metodo: 'POST', corpo });

export const criarSerie = (corpo: SerieEntrada) =>
  api.requisitar<RespostaSerie>('/series', { metodo: 'POST', corpo });

/** POST /api/sessoes/:id/status: `cobravel: true` é o "cobrar" da falta ou do cancelamento. */
export const mudarStatus = (id: string, corpo: MudancaStatus) =>
  api.requisitar<Sessao>(`/sessoes/${encodeURIComponent(id)}/status`, { metodo: 'POST', corpo });

export const cancelarSerie = (id: string, corpo: SerieCancelamento) =>
  api.requisitar<RespostaSerie>(`/series/${encodeURIComponent(id)}/cancelar`, {
    metodo: 'POST',
    corpo,
  });
